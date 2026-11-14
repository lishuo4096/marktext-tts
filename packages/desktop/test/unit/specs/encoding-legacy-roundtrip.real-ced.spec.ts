// @vitest-environment node
import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'

describe('guessEncoding with real chardet keeps legacy encodings byte-exact', () => {
  it.each([
    [
      'German Windows-1252',
      'Grüße aus München. Äpfel, Öl und Übermaß sind schön.\n'.repeat(20),
      'cp1252'
    ],
    ['sparse Latin-1', `${'plain english text line here\n'.repeat(30)}café\n`, 'latin1'],
    ['Shift JIS', '日本語のテキストです。これはシフトJISのテストです。\n'.repeat(20), 'shiftjis']
  ])('%s', async(_name, text, sourceEncoding) => {
    const { guessEncoding } = await import('main_renderer/filesystem/encoding')
    const bytes = iconv.encode(text, sourceEncoding)
    const { encoding } = guessEncoding(bytes, true)
    const decoded = iconv.decode(bytes, encoding)

    expect(encoding).not.toBe('utf8')
    expect(decoded).toBe(text)
    expect(iconv.encode(decoded, encoding).equals(bytes)).toBe(true)
  })
})
