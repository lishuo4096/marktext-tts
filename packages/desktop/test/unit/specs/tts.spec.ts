import { describe, it, expect, vi, afterEach } from 'vitest'
import { splitSentences, annotateReading } from '../../../src/renderer/src/services/tts/text'
import { ReadingFollow } from '../../../src/renderer/src/services/tts/follow'
import { ReadingPlayer } from '../../../src/renderer/src/services/tts/player'
import { buildSpeechRequest, synthesizeSpeech } from '../../../src/main/tts/provider'
import { ttsPresets } from '../../../src/shared/types/tts'

afterEach(() => vi.unstubAllGlobals())

describe('reading text and manual navigation', () => {
  it('preserves Chinese, English, emoji and offsets while respecting the provider limit', () => {
    const text = `“你好。” Next sentence! ${'长😀'.repeat(400)}`
    const parts = splitSentences(text)
    expect(parts.map(part => part.text).join('')).toBe(text)
    for (const part of parts) {
      expect([...part.text].length).toBeLessThanOrEqual(180)
      expect(text.slice(part.start, part.end)).toBe(part.text)
    }
  })
  it('maps sentences across bold/link nodes, skips code and does not duplicate lists', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>你好<strong>世界</strong>。下一句。</p><ul><li><p>列表。</p></li></ul><pre><code>skip</code></pre>'
    const parts = annotateReading(root)
    expect(parts.map(part => part.text)).toEqual(['你好世界。', '下一句。', '列表。'])
    expect([...root.querySelectorAll('[data-sentence="0"]')].map(node => node.textContent).join('')).toBe('你好世界。')
    expect(root.querySelectorAll('[data-first-sentence]')).toHaveLength(2)
  })
  it('extends suspension on each wheel action and never follows while dragging', () => {
    const follow = new ReadingFollow(8000)
    follow.interrupt(100)
    expect(follow.canFollow(8099)).toBe(false)
    follow.interrupt(8000)
    expect(follow.canFollow(15000)).toBe(false)
    follow.dragging = true
    expect(follow.canFollow(50000)).toBe(false)
    follow.resume()
    expect(follow.canFollow(50000)).toBe(true)
    follow.enabled = false
    expect(follow.canFollow(90000)).toBe(false)
  })
})

describe('provider protocols', () => {
  it('uses assistant text for MiMo and DashScope input for Qwen', () => {
    const mimo = JSON.parse(buildSpeechRequest(ttsPresets.mimo, '测试', 'fake-key').body as string)
    expect(mimo.messages).toEqual([{ role: 'assistant', content: '测试' }])
    expect(mimo.audio.format).toBe('wav')
    const qwen = JSON.parse(buildSpeechRequest(ttsPresets.qwen, '测试', 'fake-key').body as string)
    expect(qwen.input.text).toBe('测试')
  })
  it('decodes Base64 audio and avoids leaking response error bodies', async() => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { audio: { data: Buffer.from('RIFFtest').toString('base64') } } }] })))
    const bytes = await synthesizeSpeech(ttsPresets.mimo, '测试', 'fake-key', new AbortController().signal, fetcher)
    expect(Buffer.from(bytes).toString()).toBe('RIFFtest')
    fetcher.mockResolvedValue(new Response('private-error', { status: 401 }))
    await expect(synthesizeSpeech(ttsPresets.mimo, '测试', 'fake-key', new AbortController().signal, fetcher)).rejects.toThrow('HTTP 401')
  })
  it('downloads Qwen audio without sending the API authorization header', async() => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ output: { audio: { url: 'http://example.org/test.wav' } } }))).mockResolvedValueOnce(new Response('RIFFaudio'))
    await synthesizeSpeech(ttsPresets.qwen, '测试', 'fake-key', new AbortController().signal, fetcher)
    expect(String(fetcher.mock.calls[1]![0])).toBe('https://example.org/test.wav')
    expect(fetcher.mock.calls[1]![1]).not.toHaveProperty('headers')
  })
})

describe('continuous playback cancellation', () => {
  class FakeAudio {
    static instances: FakeAudio[] = []
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    playbackRate = 1
    pause = vi.fn()
    play = vi.fn().mockResolvedValue(undefined)
    load = vi.fn()
    removeAttribute = vi.fn()
    constructor() { FakeAudio.instances.push(this) }
  }
  function setup(synth = vi.fn().mockResolvedValue(new Uint8Array([1]))) {
    FakeAudio.instances = []
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:test'), revokeObjectURL: vi.fn() })
    return new ReadingPlayer(synth, vi.fn().mockResolvedValue(undefined), vi.fn())
  }
  it('continues to the next sentence and reaches the end', async() => {
    const player = setup()
    await player.start(['甲。', '乙。'])
    expect(player.state).toBe('playing')
    FakeAudio.instances[0]!.onended!()
    await vi.waitFor(() => expect(player.index).toBe(1))
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(2))
    FakeAudio.instances[1]!.onended!()
    expect(player.state).toBe('ended')
  })
  it('never plays a stale request after jumping to another paragraph', async() => {
    let resolveOld!: (bytes: Uint8Array) => void
    const synth = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValue(new Uint8Array([2]))
    const player = setup(synth)
    const old = player.start(['旧句。'])
    await player.start(['新句。'])
    resolveOld(new Uint8Array([1]))
    await old
    expect(FakeAudio.instances).toHaveLength(1)
    expect(player.state).toBe('playing')
  })
  it('keeps a pending sentence paused and resumes it only once', async() => {
    let resolve!: (bytes: Uint8Array) => void
    const player = setup(vi.fn().mockImplementation(() => new Promise(done => { resolve = done })))
    const starting = player.start(['测试。'])
    player.pause()
    const resuming = player.resume()
    resolve(new Uint8Array([1]))
    await Promise.all([starting, resuming])
    expect(FakeAudio.instances).toHaveLength(1)
    player.stop()
    expect(FakeAudio.instances[0]!.pause).toHaveBeenCalled()
  })
  it('preloads six sentences with at most two synthesis calls in flight', async() => {
    const pending: Array<() => void> = []
    let active = 0
    let peak = 0
    const synth = vi.fn().mockImplementation(() => {
      active++
      peak = Math.max(peak, active)
      return new Promise<Uint8Array>(resolve => pending.push(() => { active--; resolve(new Uint8Array([1])) }))
    })
    const player = setup(synth)
    const starting = player.start(Array.from({ length: 100 }, (_, i) => `第${i}句。`))
    expect(synth).toHaveBeenCalledTimes(2)
    while (pending.length) {
      const batch = pending.splice(0)
      batch.forEach(resolve => resolve())
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    await starting
    expect(peak).toBe(2)
    expect(synth).toHaveBeenCalledTimes(6)
    expect(player.bufferedSentences).toBe(5)
    expect(FakeAudio.instances[1]!.load).toHaveBeenCalled()
    FakeAudio.instances[0]!.onended!()
    await vi.waitFor(() => expect(player.index).toBe(1))
    expect(FakeAudio.instances[1]!.play).toHaveBeenCalledTimes(1)
    player.stop()
    pending.splice(0).forEach(resolve => resolve())
  })
  it('defers a failed future request until its sentence becomes current', async() => {
    const synth = vi.fn().mockResolvedValueOnce(new Uint8Array([1])).mockRejectedValue(new Error('HTTP 429'))
    const player = setup(synth)
    await player.start(['当前句。', '失败句。'])
    expect(player.state).toBe('playing')
    FakeAudio.instances[0]!.onended!()
    await vi.waitFor(() => expect(player.state).toBe('error'))
    player.stop()
  })
})
