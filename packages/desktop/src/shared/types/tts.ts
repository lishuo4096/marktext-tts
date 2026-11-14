export type TtsProvider = 'mimo' | 'qwen' | 'openai'

export interface TtsSettings {
  provider: TtsProvider
  endpoint: string
  model: string
  voice: string
  instructions: string
  hasKey?: boolean
}

export const ttsPresets: Record<TtsProvider, TtsSettings> = {
  mimo: { provider: 'mimo', endpoint: 'https://api.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5-tts', voice: 'mimo_default', instructions: '' },
  qwen: { provider: 'qwen', endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', model: 'qwen3-tts-flash', voice: 'Cherry', instructions: '' },
  openai: { provider: 'openai', endpoint: 'https://api.openai.com/v1/audio/speech', model: 'tts-1', voice: 'alloy', instructions: '' }
}
