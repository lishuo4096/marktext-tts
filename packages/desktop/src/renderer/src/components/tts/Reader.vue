<script setup lang="ts">
import { ref, reactive, computed, nextTick, onUnmounted, watch } from 'vue'
import { MarkdownToHtml } from '@muyajs/core'
import DOMPurify from 'dompurify'
import { useEditorStore } from '@/store/editor'
import { ttsPresets, type TtsProvider } from '@shared/types/tts'
import { annotateReading, type ReadingSentence } from '@/services/tts/text'
import { ReadingPlayer, type PlayerState } from '@/services/tts/player'
import { ReadingFollow } from '@/services/tts/follow'
import 'github-markdown-css/github-markdown.css'

const store = useEditorStore()
const opened = ref(false)
const configuring = ref(false)
const content = ref<HTMLElement>()
const viewport = ref<HTMLElement>()
const settings = reactive({ ...ttsPresets.mimo })
const apiKey = ref('')
const status = ref<PlayerState>('idle')
const message = ref('')
const index = ref(0)
const slider = ref(0)
const count = ref(0)
const buffered = ref(0)
const rate = ref(1)
const fontSize = ref(21)
const dark = ref(false)
const follow = reactive(new ReadingFollow())
const following = ref(true)
const delay = ref(8)
const menu = ref<{ x: number; y: number; index: number } | null>(null)
let sentences: ReadingSentence[] = []
let progressKey = ''
let renderVersion = 0
let expectedScrollTop: number | null = null
const invoke = window.electron.ipcRenderer.invoke
const labels: Record<PlayerState, string> = { idle: '准备就绪', loading: '正在合成 / 缓冲…', playing: '正在朗读', paused: '已暂停', ended: '全文朗读完成', error: '朗读中断' }
const playing = computed(() => ['loading', 'playing'].includes(status.value))

function paint(): void {
  content.value?.querySelectorAll('.tts-speaking').forEach(node => node.classList.remove('tts-speaking'))
  if (['playing', 'paused'].includes(status.value)) {
    content.value?.querySelectorAll(`[data-sentence="${index.value}"]`).forEach(node => node.classList.add('tts-speaking'))
  }
}

const player = new ReadingPlayer(
  (id, text) => invoke('mt::tts::speak', id, text),
  () => invoke('mt::tts::cancel'),
  (state, current, error) => {
    status.value = state
    index.value = Math.min(current, Math.max(0, count.value - 1))
    slider.value = index.value
    if (error) message.value = error
    if (state === 'playing' && progressKey) localStorage.setItem(progressKey, String(current))
    paint()
    if (state === 'playing') scrollToCurrent()
  }
)

function scrollToCurrent(force = false): void {
  following.value = follow.canFollow()
  if (!force && (!following.value || status.value !== 'playing')) return
  const node = content.value?.querySelector<HTMLElement>(`[data-sentence="${index.value}"]`)
  const view = viewport.value
  if (!node || !view) return
  const bounds = node.getBoundingClientRect()
  const frame = view.getBoundingClientRect()
  if (force || bounds.top < frame.top + frame.height * 0.18 || bounds.bottom > frame.top + frame.height * 0.7) {
    const target = view.scrollTop + bounds.top - frame.top - frame.height * 0.32
    expectedScrollTop = Math.max(0, Math.min(target, view.scrollHeight - view.clientHeight))
    view.scrollTo({ top: expectedScrollTop, behavior: 'instant' })
  }
}

function interrupt(): void { follow.interrupt(); following.value = false }
function onScroll(): void {
  const top = viewport.value?.scrollTop ?? 0
  if (expectedScrollTop !== null && Math.abs(top - expectedScrollTop) < 2) {
    expectedScrollTop = null
    return
  }
  expectedScrollTop = null
  interrupt()
}
function pointerDown(): void { follow.dragging = true; interrupt() }
function pointerUp(): void { if (follow.dragging) { follow.dragging = false; interrupt() } }
function backToVoice(): void { follow.resume(); following.value = true; scrollToCurrent(true) }
function keyScroll(event: KeyboardEvent): void {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interrupt()
}

async function open(): Promise<void> {
  opened.value = true
  Object.assign(settings, await invoke('mt::tts::settings'))
  await renderDocument()
}

async function renderDocument(): Promise<void> {
  const version = ++renderVersion
  player.stop()
  message.value = ''
  sentences = []
  count.value = 0
  const file = store.currentFile
  if (!file) return
  const markdown = file.markdown
  let hash = 2166136261
  for (let i = 0; i < markdown.length; i++) hash = Math.imul(hash ^ markdown.charCodeAt(i), 16777619)
  progressKey = `marktext-tts:${file.pathname || file.id}:${hash >>> 0}`
  try {
    const html = await new MarkdownToHtml(markdown).renderHtmlWithHeadings()
    if (version !== renderVersion || !opened.value) return
    await nextTick()
    if (!content.value) return
    content.value.innerHTML = DOMPurify.sanitize(html.html)
    sentences = annotateReading(content.value)
    count.value = sentences.length
    const saved = Number(localStorage.getItem(progressKey) ?? 0)
    index.value = Number.isFinite(saved) ? Math.max(0, Math.min(saved, count.value - 1)) : 0
    slider.value = index.value
    await nextTick()
    scrollToCurrent(true)
  } catch { message.value = '文档渲染失败，请返回编辑器检查 Markdown' }
}

async function start(at = index.value): Promise<void> {
  message.value = ''
  menu.value = null
  follow.resume()
  await player.start(sentences.map(sentence => sentence.text), at)
}

function toggle(): void {
  if (playing.value) player.pause()
  else if (status.value === 'paused') void player.resume()
  else void start(status.value === 'ended' ? 0 : index.value)
}

function close(): void { renderVersion++; player.stop(); opened.value = false; menu.value = null }
function contextMenu(event: MouseEvent): void {
  const block = (event.target as Element).closest<HTMLElement>('[data-first-sentence]')
  if (!block) return
  event.preventDefault()
  menu.value = { x: Math.min(event.clientX, window.innerWidth - 240), y: Math.min(event.clientY, window.innerHeight - 70), index: Number(block.dataset.firstSentence) }
}
function doubleClick(event: MouseEvent): void {
  const sentence = (event.target as Element).closest<HTMLElement>('[data-sentence]')
  if (sentence) void start(Number(sentence.dataset.sentence))
}
function chooseProvider(event: Event): void {
  Object.assign(settings, ttsPresets[(event.target as HTMLSelectElement).value as TtsProvider])
  apiKey.value = ''
}
async function save(): Promise<void> {
  player.stop()
  try {
    await invoke('mt::tts::save', { ...settings }, apiKey.value || undefined)
    apiKey.value = ''
    Object.assign(settings, await invoke('mt::tts::settings'))
    configuring.value = false
    message.value = '设置已保存'
  } catch (error) { message.value = String(error) }
}

watch(() => [store.currentFile?.id, store.currentFile?.markdown], () => { if (opened.value) void renderDocument() })
watch(rate, value => player.setRate(value))
watch(delay, value => { follow.delayMs = value * 1000 })
window.addEventListener('pointerup', pointerUp)
window.addEventListener('pointercancel', pointerUp)
const timer = window.setInterval(() => {
  if (opened.value) {
    buffered.value = player.bufferedSentences
    scrollToCurrent()
  }
}, 400)
onUnmounted(() => { player.stop(); clearInterval(timer); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', pointerUp) })
</script>

<template>
  <button
    v-if="!opened && store.currentFile"
    class="tts-launch"
    title="小说式连续朗读"
    @click="open"
  >
    ♫ 阅读与朗读
  </button>
  <section
    v-if="opened"
    class="tts-reader"
    :class="{ 'tts-dark': dark }"
    aria-label="Markdown 朗读阅读器"
  >
    <header class="tts-header">
      <div><strong>MarkText · 听读</strong><span>{{ store.currentFile?.filename }}</span></div>
      <nav>
        <button @click="fontSize = Math.max(14, fontSize - 2)">
          A−
        </button><button @click="fontSize = Math.min(36, fontSize + 2)">
          A＋
        </button>
        <button @click="dark = !dark">
          {{ dark ? '日间' : '夜间' }}
        </button>
        <button @click="configuring = !configuring">
          语音设置
        </button><button @click="close">
          返回编辑器
        </button>
      </nav>
    </header>
    <form
      v-if="configuring"
      class="tts-settings"
      @submit.prevent="save"
    >
      <label>服务<select
        :value="settings.provider"
        @change="chooseProvider"
      ><option value="mimo">小米 MiMo</option><option value="qwen">阿里云千问</option><option value="openai">OpenAI 兼容 TTS</option></select></label>
      <label class="tts-wide">完整 API 地址<input
        v-model="settings.endpoint"
        required
        type="url"
      ></label>
      <label>模型<input
        v-model="settings.model"
        required
      ></label><label>音色<input
        v-model="settings.voice"
        required
        list="tts-voices"
      ><datalist id="tts-voices"><option>mimo_default</option><option>冰糖</option><option>茉莉</option><option>苏打</option><option>白桦</option><option>Cherry</option></datalist></label>
      <label>API Key<input
        v-model="apiKey"
        type="password"
        autocomplete="off"
        :placeholder="settings.hasKey ? '已加密保存；留空保留' : '输入服务密钥'"
      ></label>
      <label>语气指令（MiMo / 兼容服务）<input
        v-model="settings.instructions"
        placeholder="温暖、平静的小说旁白"
      ></label>
      <label>手动浏览后恢复跟随<select v-model.number="delay"><option :value="4">4 秒</option><option :value="8">8 秒</option><option :value="15">15 秒</option><option :value="30">30 秒</option></select></label>
      <p>朗读会向所选服务发送当前句与下一句。密钥由 Windows 系统加密后保存在本机；千问需选择与密钥一致的地域地址。</p>
      <button type="submit">
        保存设置
      </button>
    </form>
    <div
      ref="viewport"
      class="tts-viewport"
      tabindex="0"
      @wheel.passive="interrupt"
      @scroll.passive="onScroll"
      @touchmove.passive="interrupt"
      @pointerdown="pointerDown"
      @keydown="keyScroll"
      @click="menu = null"
      @contextmenu="contextMenu"
      @dblclick="doubleClick"
    >
      <div
        ref="content"
        class="tts-content"
        :style="{ fontSize: `${fontSize}px` }"
        @click.prevent
      />
      <p
        v-if="!count"
        class="tts-empty"
      >
        打开 Markdown 文档后即可朗读。代码块和图表不会加入朗读队列。
      </p>
    </div>
    <button
      v-if="!following || !follow.enabled"
      class="tts-return"
      @click="backToVoice"
    >
      回到朗读位置 · 恢复跟随
    </button>
    <footer class="tts-controls">
      <div class="tts-progress">
        <span>{{ count ? index + 1 : 0 }} / {{ count }} 句</span><input
          v-model.number="slider"
          aria-label="朗读进度"
          type="range"
          min="0"
          :max="Math.max(0, count - 1)"
          :disabled="!count"
          @change="start(slider)"
        ><span>{{ labels[status] }}</span>
      </div>
      <div class="tts-actions">
        <button
          :disabled="!count || index <= 0"
          @click="start(index - 1)"
        >
          上一句
        </button>
        <button
          class="tts-primary"
          :disabled="!count"
          @click="toggle"
        >
          {{ playing ? '暂停' : status === 'paused' ? '继续' : '开始朗读' }}
        </button>
        <button
          :disabled="!count"
          @click="player.stop()"
        >
          停止
        </button><button
          :disabled="!count || index >= count - 1"
          @click="start(index + 1)"
        >
          下一句
        </button>
        <label>倍速 <select v-model.number="rate"><option
          v-for="speed in [0.75, 1, 1.25, 1.5, 1.75, 2]"
          :key="speed"
          :value="speed"
        >{{ speed }}×</option></select></label>
        <label><input
          v-model="follow.enabled"
          type="checkbox"
        >自动跟随</label>
        <span class="tts-hint">已预载 {{ buffered }} 句 · 右键从此段朗读 · 双击从此句朗读</span>
      </div>
      <div
        v-if="message"
        class="tts-message"
        role="status"
      >
        {{ message }}
      </div>
    </footer>
    <button
      v-if="menu"
      class="tts-context"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click="start(menu.index)"
    >
      ▶ 从此段开始连续朗读
    </button>
  </section>
</template>

<style>
.tts-launch{position:fixed;right:30px;bottom:48px;z-index:200;background:#32776d;color:white;border:0;border-radius:24px;padding:12px 22px;cursor:pointer;box-shadow:0 4px 20px #0002}
.tts-reader{--tts-bg:#f6f3ec;--tts-ink:#303b36;--tts-panel:#fffdf8;position:fixed;inset:0;z-index:3000;display:flex;flex-direction:column;background:var(--tts-bg);color:var(--tts-ink);font:14px system-ui,sans-serif;-webkit-app-region:no-drag}
.tts-reader.tts-dark{--tts-bg:#1c2524;--tts-panel:#25302d;--tts-ink:#d5ded7;color-scheme:dark}
.tts-reader button,.tts-reader select,.tts-reader input:not([type=range]):not([type=checkbox]){border:1px solid #87988b66;background:var(--tts-panel);color:var(--tts-ink);border-radius:7px;padding:7px 10px;font:inherit}
.tts-reader button{cursor:pointer}.tts-reader button:hover{border-color:#478c76}.tts-reader button:disabled{opacity:.4;cursor:default}.tts-reader input{min-width:0}.tts-reader input[type=range]{accent-color:#387e67}
.tts-header{padding:18px 28px;border-bottom:1px solid #87988b44;display:flex;align-items:center;justify-content:space-between;gap:20px;background:var(--tts-panel)}.tts-header strong{display:block;letter-spacing:1px}.tts-header span{display:block;margin-top:4px;opacity:.6;max-width:30vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tts-header nav{display:flex;gap:8px}
.tts-viewport{flex:1;min-height:0;overflow-y:scroll;overscroll-behavior:contain;scrollbar-gutter:stable;outline:none}.tts-content{max-width:810px;margin:0 auto;padding:50px 60px 45vh;line-height:1.95;font-family:Georgia,'Noto Serif SC','Microsoft YaHei',serif;overflow-wrap:anywhere}.tts-content .markdown-body{background:transparent;color:inherit;font:inherit}.tts-content p{margin:0 0 1.3em}.tts-content img{max-width:100%}.tts-content pre{padding:16px;overflow:auto;background:#8881}.tts-content blockquote{border-left:3px solid #669482;padding-left:20px;opacity:.85}.tts-content table{border-collapse:collapse}.tts-content td,.tts-content th{padding:8px;border:1px solid #87988b66}.tts-speaking{background:#e4b95f66;border-radius:3px;box-shadow:0 2px 0 #c48c31}.tts-dark .tts-speaking{background:#b8863466}.tts-content [data-first-sentence]{cursor:text}
.tts-settings{max-height:48vh;overflow:auto;padding:18px 28px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;border-bottom:1px solid #87988b44;background:var(--tts-panel)}.tts-settings label{display:flex;flex-direction:column;gap:5px}.tts-settings .tts-wide{grid-column:span 2}.tts-settings p{grid-column:span 2;margin:0;opacity:.7;line-height:1.6}.tts-controls{padding:14px 28px 18px;background:var(--tts-panel);border-top:1px solid #87988b44}.tts-progress{display:flex;gap:15px;align-items:center;margin-bottom:12px}.tts-progress input{flex:1}.tts-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.tts-reader .tts-primary{background:#32776d;color:#fff;border-color:#32776d;min-width:100px}.tts-hint{opacity:.55;font-size:12px;margin-left:auto}.tts-message{margin-top:10px;color:#bb7333;user-select:text}.tts-return{position:absolute;right:35px;bottom:155px;box-shadow:0 4px 20px #0002}.tts-context{position:fixed;z-index:3001;box-shadow:0 4px 20px #0003}.tts-empty{text-align:center;padding:40px}.tts-content:empty{display:none}
@media(max-width:850px){.tts-content{padding-left:30px;padding-right:30px}.tts-header{padding:12px}.tts-header nav{gap:3px}.tts-hint{display:none}}
</style>
