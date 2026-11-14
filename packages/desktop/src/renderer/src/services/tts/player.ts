export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

/** Owns one bounded audio queue; a generation prevents stale requests from resuming playback. */
export class ReadingPlayer {
  state: PlayerState = 'idle'
  index = 0
  rate = 1
  private generation = 0
  private advanceVersion = 0
  private audio: HTMLAudioElement | null = null
  private url: string | null = null
  private cache = new Map<number, Promise<Uint8Array>>()
  private prepared = new Map<number, { audio: HTMLAudioElement; url: string }>()
  private requested = new Set<number>()
  private activeRequests = 0
  private startIndex = 0
  private lastEndedAt: number | null = null
  readonly gapsMs: number[] = []
  readonly lookAhead = 6
  private sentences: string[] = []

  constructor(private synthesize: (id: string, text: string) => Promise<Uint8Array>, private cancel: () => Promise<void>, private changed: (state: PlayerState, index: number, error?: string) => void) {}

  private emit(state: PlayerState, error?: string): void {
    this.state = state
    this.changed(state, this.index, error)
  }

  private releaseAudio(): void {
    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
    }
    this.audio = null
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
  }

  stop(): void {
    this.generation++
    this.releaseAudio()
    this.cache.clear()
    for (const entry of this.prepared.values()) {
      entry.audio.removeAttribute('src')
      entry.audio.load()
      URL.revokeObjectURL(entry.url)
    }
    this.prepared.clear()
    this.requested.clear()
    this.activeRequests = 0
    this.lastEndedAt = null
    this.gapsMs.length = 0
    void this.cancel().catch(() => {})
    this.emit('idle')
  }

  async start(sentences: string[], index = 0): Promise<void> {
    this.stop()
    this.sentences = sentences
    this.index = Math.max(0, Math.min(index, sentences.length - 1))
    this.startIndex = this.index
    if (!sentences.length) return
    this.fillQueue(this.generation)
    await this.advance(this.generation)
  }

  pause(): void {
    if (!['loading', 'playing'].includes(this.state)) return
    this.audio?.pause()
    this.lastEndedAt = null
    this.emit('paused')
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return
    if (this.audio) {
      const generation = this.generation
      const audio = this.audio
      this.emit('loading')
      try {
        await audio.play()
        if (generation === this.generation && !this.isPaused()) {
          this.emit('playing')
          this.fillQueue(generation)
        }
        else audio.pause()
      } catch {
        if (generation === this.generation) this.emit('error', '音频播放失败，请重试')
      }
    } else {
      await this.advance(this.generation)
    }
  }

  setRate(rate: number): void {
    this.rate = rate
    if (this.audio) this.audio.playbackRate = rate
  }

  private request(index: number, generation: number): Promise<Uint8Array> {
    let promise = this.cache.get(index)
    if (!promise) {
      promise = this.synthesize(`${generation}-${index}`, this.sentences[index]!)
      // Prefetch errors are observed again when the sentence becomes current.
      void promise.catch(() => {})
      this.cache.set(index, promise)
    }
    return promise
  }

  private fillQueue(generation: number): void {
    if (generation !== this.generation || ['idle', 'ended', 'error', 'paused'].includes(this.state)) return
    for (let next = this.index; next < Math.min(this.sentences.length, this.index + this.lookAhead); next++) {
      if (this.activeRequests >= 2) break
      if (this.requested.has(next)) continue
      this.requested.add(next)
      this.activeRequests++
      const position = next
      void this.request(position, generation).then(bytes => {
        if (generation !== this.generation || position < this.index) return
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }))
        const audio = new Audio()
        audio.preload = 'auto'
        audio.src = url
        audio.load()
        this.prepared.set(position, { audio, url })
      }).catch(() => {}).finally(() => {
        if (generation !== this.generation) return
        this.activeRequests--
        this.fillQueue(generation)
      })
    }
  }

  private async advance(generation: number): Promise<void> {
    if (generation !== this.generation) return
    const version = ++this.advanceVersion
    this.releaseAudio()
    if (this.index >= this.sentences.length) { this.emit('ended'); return }
    this.emit('loading')
    this.fillQueue(generation)
    try {
      const bytes = await this.request(this.index, generation)
      // A two-sentence startup buffer absorbs the first short dialogue's synthesis latency.
      if (this.index === this.startIndex && this.index + 1 < this.sentences.length) {
        await this.request(this.index + 1, generation).catch(() => {})
      }
      if (generation !== this.generation || version !== this.advanceVersion) return
      // Pausing during synthesis preserves this sentence for resume.
      if (this.state === 'paused') return
      const ready = this.prepared.get(this.index)
      this.url = ready?.url ?? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }))
      const audio = this.audio = ready?.audio ?? new Audio(this.url)
      this.prepared.delete(this.index)
      audio.playbackRate = this.rate
      audio.onended = () => {
        this.lastEndedAt = performance.now()
        this.cache.delete(this.index)
        this.requested.delete(this.index)
        this.index++
        void this.advance(generation)
      }
      audio.onerror = () => {
        if (generation === this.generation) { this.releaseAudio(); this.emit('error', '音频无法解码，请检查 API 返回格式') }
      }
      await audio.play()
      if (generation !== this.generation || this.isPaused()) { audio.pause(); return }
      this.emit('playing')
      if (this.lastEndedAt !== null) {
        this.gapsMs.push(performance.now() - this.lastEndedAt)
        if (this.gapsMs.length > 100) this.gapsMs.shift()
      }
      this.lastEndedAt = null
      this.fillQueue(generation)
    } catch (error) {
      if (generation !== this.generation) return
      this.cache.delete(this.index)
      this.emit('error', error instanceof Error ? error.message : '朗读失败')
    }
  }

  private isPaused(): boolean { return this.state === 'paused' }

  get bufferedSentences(): number { return this.prepared.size }
}
