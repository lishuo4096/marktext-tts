import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('desktop continuous TTS, sentence highlight, manual scroll and paragraph restart', async() => {
  test.setTimeout(120000)
  const root = path.resolve(__dirname, '../..')
  const temp = mkdtempSync(path.join(os.tmpdir(), 'marktext-tts-e2e-'))
  const document = path.join(temp, '听读测试.md')
  writeFileSync(document, '# 听读测试\n\n' + Array.from({ length: 35 }, (_, i) => `第${i + 1}段。你好，这是朗读测试。`).join('\n\n'))
  const executablePath = process.env.TTS_PACKAGED_EXE || path.resolve(root, '../../node_modules/electron/dist/electron.exe')
  const args = [...(process.env.TTS_PACKAGED_EXE ? [] : [root]), '--user-data-dir', temp, document]
  const app = await electron.launch({ executablePath, args, env: { ...process.env, MARKTEXT_ERROR_INTERACTION: '1' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: '♫ 阅读与朗读' }).click({ timeout: 30000 })
    await expect(page.locator('.tts-content [data-sentence]')).not.toHaveCount(0)
    await page.getByRole('button', { name: '语音设置' }).click()
    if (process.env.MIMO_TEST_KEY) {
      const bytes = await page.evaluate(async(key) => {
        const ipc = window.electron.ipcRenderer
        await ipc.invoke('mt::tts::save', { provider: 'mimo', endpoint: 'https://api.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5-tts', voice: 'mimo_default', instructions: '' }, key)
        const audio = await ipc.invoke('mt::tts::speak', 'live-smoke', '你好，这是应用内的朗读测试。')
        return [...audio]
      }, process.env.MIMO_TEST_KEY)
      expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('RIFF')
    }
    await page.getByText('手动浏览后恢复跟随').locator('select').selectOption('8')
    await page.getByRole('button', { name: '语音设置' }).click()
    const audio = Buffer.alloc(44 + 24000 * 2 * 2)
    audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
    audio.writeUInt32LE(24000, 24); audio.writeUInt32LE(48000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34)
    audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
    await app.evaluate(({ ipcMain }, bytes) => {
      ipcMain.removeHandler('mt::tts::speak')
      ipcMain.handle('mt::tts::speak', () => new Uint8Array(bytes))
    }, [...audio])
    await page.getByRole('button', { name: '开始朗读', exact: true }).click()
    await expect(page.locator('.tts-speaking').first()).toBeVisible()
    await expect(page.locator('.tts-progress')).toContainText('正在朗读')
    await expect(page.locator('.tts-progress')).toContainText('3 /', { timeout: 15000 })
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await expect(page.locator('.tts-progress')).toContainText('已暂停')
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await page.locator('.tts-viewport').hover()
    await page.mouse.wheel(0, 650)
    await expect(page.getByRole('button', { name: /回到朗读位置/ })).toBeVisible()
    const position = await page.locator('.tts-viewport').evaluate(async(node) => {
      node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 200 }))
      const before = node.scrollTop
      await new Promise(resolve => setTimeout(resolve, 2300))
      return { before, after: node.scrollTop }
    })
    expect(position.after).toBeCloseTo(position.before, 0)
    await page.getByRole('button', { name: /回到朗读位置/ }).click()
    await expect(page.getByRole('button', { name: /回到朗读位置/ })).not.toBeVisible()
    await page.locator('[data-paragraph="10"]').click({ button: 'right' })
    await page.getByRole('button', { name: '▶ 从此段开始连续朗读' }).click()
    await expect(page.locator('[data-paragraph="10"] .tts-speaking').first()).toBeVisible()
    await page.locator('[aria-label="朗读进度"]').fill('40')
    await page.locator('[aria-label="朗读进度"]').dispatchEvent('change')
    await expect(page.locator('[data-sentence="40"].tts-speaking').first()).toBeVisible()
    await page.locator('.tts-viewport').evaluate(node => {
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: node.getBoundingClientRect().right - 2 }))
      node.scrollTop += 300
    })
    await page.waitForTimeout(500)
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup')))
    await expect(page.getByRole('button', { name: /回到朗读位置/ })).toBeVisible()
    await page.getByRole('button', { name: /回到朗读位置/ }).click()
    await page.screenshot({ path: path.join(os.tmpdir(), 'marktext-tts-reader.png') })
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await app.close()
  }
})
