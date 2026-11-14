import { app, ipcMain, safeStorage } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { ttsPresets, type TtsSettings } from '../../shared/types/tts'
import { synthesizeSpeech } from '../tts/provider'

type Stored = { settings: TtsSettings; keys: Record<string, string> }
const requests = new Map<number, Map<string, AbortController>>()
const watchedOwners = new Set<number>()
const configPath = () => path.join(app.getPath('userData'), 'tts-settings.json')
async function readConfig(): Promise<Stored> {
  try { return JSON.parse(await readFile(configPath(), 'utf8')) as Stored } catch { return { settings: { ...ttsPresets.mimo }, keys: {} } }
}

export function registerTtsHandlers(): void {
  ipcMain.handle('mt::tts::settings', async() => {
    const data = await readConfig()
    return { ...data.settings, hasKey: Boolean(data.keys[data.settings.provider]) }
  })
  ipcMain.handle('mt::tts::save', async(_event, settings: TtsSettings, key?: string) => {
    if (!ttsPresets[settings.provider]) throw new Error('不支持的服务')
    const url = new URL(settings.endpoint)
    if (url.username || url.password) throw new Error('请勿在地址中填写密钥')
    const data = await readConfig()
    if (key) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，无法保存 API Key')
      data.keys[settings.provider] = safeStorage.encryptString(key.trim()).toString('base64')
    }
    data.settings = { provider: settings.provider, endpoint: settings.endpoint, model: settings.model, voice: settings.voice, instructions: settings.instructions }
    await mkdir(path.dirname(configPath()), { recursive: true })
    await writeFile(configPath(), JSON.stringify(data), { mode: 0o600 })
  })
  ipcMain.handle('mt::tts::cancel', (event) => {
    for (const controller of requests.get(event.sender.id)?.values() ?? []) controller.abort()
    requests.delete(event.sender.id)
  })
  ipcMain.handle('mt::tts::speak', async(event, id: string, text: string) => {
    if (typeof text !== 'string' || !text.trim() || [...text].length > 500) throw new Error('每段需为 1–500 字')
    const owner = event.sender.id
    let pending = requests.get(owner)
    if (!pending) {
      pending = new Map()
      requests.set(owner, pending)
    }
    if (!watchedOwners.has(owner)) {
      watchedOwners.add(owner)
      event.sender.once('destroyed', () => {
        for (const controller of requests.get(owner)?.values() ?? []) controller.abort()
        requests.delete(owner)
        watchedOwners.delete(owner)
      })
    }
    if (pending.size >= 3 || pending.has(id)) throw new Error('朗读请求过多')
    const controller = new AbortController()
    pending.set(id, controller)
    const timeout = setTimeout(() => controller.abort(), 60000)
    try {
      const data = await readConfig()
      const encrypted = data.keys[data.settings.provider]
      if (!encrypted) throw new Error('请先在朗读设置中保存 API Key')
      const key = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      return await synthesizeSpeech(data.settings, text, key, controller.signal)
    } finally {
      clearTimeout(timeout)
      pending.delete(id)
    }
  })
}
