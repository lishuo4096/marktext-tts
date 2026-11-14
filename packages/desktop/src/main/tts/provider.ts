import type { TtsSettings } from '../../shared/types/tts'

export function buildSpeechRequest(settings: TtsSettings, text: string, key: string): RequestInit {
  const { provider, model, voice, instructions } = settings
  let body: object
  if (provider === 'mimo') {
    body = { model, messages: [...(instructions ? [{ role: 'user', content: instructions }] : []), { role: 'assistant', content: text }], audio: { format: 'wav', voice }, stream: false }
  } else if (provider === 'qwen') {
    body = { model, input: { text, voice, language_type: 'Auto' } }
  } else {
    body = { model, input: text, voice, response_format: 'wav', ...(instructions ? { instructions } : {}) }
  }
  return { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), redirect: 'error' }
}

type SpeechJson = { output?: { audio?: { url?: string } }; choices?: { message?: { audio?: { data?: string } } }[] }

export async function synthesizeSpeech(settings: TtsSettings, text: string, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const url = new URL(settings.endpoint)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('API 地址必须使用 HTTPS（本机服务可使用 HTTP）')
  const response = await fetcher(url, { ...buildSpeechRequest(settings, text, key), signal })
  if (!response.ok) throw new Error(`TTS 请求失败：HTTP ${response.status}。请检查密钥、模型、额度及服务区域。`)
  let bytes: Uint8Array
  if (settings.provider === 'openai') {
    bytes = new Uint8Array(await response.arrayBuffer())
  } else {
    const data = await response.json() as SpeechJson
    if (settings.provider === 'mimo') {
      const base64 = data.choices?.[0]?.message?.audio?.data
      if (!base64) throw new Error('MiMo 未返回音频，请检查模型与音色')
      bytes = new Uint8Array(Buffer.from(base64, 'base64'))
    } else {
      const audioUrl = data.output?.audio?.url
      if (!audioUrl) throw new Error('千问未返回音频地址')
      const parsed = new URL(audioUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('无效音频地址')
      // Signed OSS URLs can use HTTP; upgrade before downloading without credentials.
      parsed.protocol = 'https:'
      const audio = await fetcher(parsed, { signal, credentials: 'omit' })
      if (!audio.ok) throw new Error(`音频下载失败：HTTP ${audio.status}`)
      bytes = new Uint8Array(await audio.arrayBuffer())
    }
  }
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('音频为空或超过 20 MB')
  return bytes
}
