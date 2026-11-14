export interface ReadingSentence { text: string; start: number; end: number; paragraph: number }

export function splitSentences(text: string, paragraph = 0, limit = 180): ReadingSentence[] {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'sentence' })
  const result: ReadingSentence[] = []
  for (const item of segmenter.segment(text)) {
    let start = item.index
    let buffer = ''
    for (const char of item.segment) {
      buffer += char
      if ([...buffer].length >= limit) {
        if (buffer.trim()) result.push({ text: buffer, start, end: start + buffer.length, paragraph })
        start += buffer.length
        buffer = ''
      }
    }
    if (buffer.trim()) result.push({ text: buffer, start, end: start + buffer.length, paragraph })
  }
  return result
}

export function annotateReading(root: HTMLElement): ReadingSentence[] {
  const sentences: ReadingSentence[] = []
  const selector = 'p, h1, h2, h3, h4, h5, h6, li, td, th'
  const blocks = [...root.querySelectorAll<HTMLElement>(selector)].filter(node => !node.querySelector(selector) && !node.closest('pre, svg, .katex, .mermaid'))
  blocks.forEach((block, paragraph) => {
    const offset = sentences.length
    const parts = splitSentences(block.textContent ?? '', paragraph)
    if (!parts.length) return
    block.dataset.paragraph = String(paragraph)
    block.dataset.firstSentence = String(offset)
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    let position = 0
    for (const node of nodes) {
      const text = node.data
      const fragment = document.createDocumentFragment()
      let consumed = 0
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index]!
        const from = Math.max(0, part.start - position)
        const to = Math.min(text.length, part.end - position)
        if (to <= from) continue
        if (from > consumed) fragment.append(text.slice(consumed, from))
        const span = document.createElement('span')
        span.dataset.sentence = String(offset + index)
        span.textContent = text.slice(from, to)
        fragment.append(span)
        consumed = to
      }
      if (consumed < text.length) fragment.append(text.slice(consumed))
      node.replaceWith(fragment)
      position += text.length
    }
    sentences.push(...parts)
  })
  return sentences
}
