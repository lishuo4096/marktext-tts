# MarkText TTS 听读版

基于 MarkText 完整源码增加小说式 Markdown 连续朗读，保留原编辑、目录、主题、文件打开和保存功能。上游基线为 `f3b15b9411a98eb6008cb2d3e399044ed1fb172e`，MIT 许可证见 [LICENSE](LICENSE)。

## 立即使用

双击 `启动听读.cmd`，或打开 `dist/tts-upgrade/win-unpacked/marktext.exe`。打开 Markdown 文档，点击右下角“阅读与朗读”，进入“语音设置”填写服务、模型、音色和 API Key，保存后点击“开始朗读”。附带 [听读示例](examples/听读示例.md)。旧版 `dist/win-unpacked` 保留作回退，新版沿用本机已有语音配置。

| 操作 | 效果 |
| --- | --- |
| 开始 / 暂停 / 继续 / 停止 | 按实际音频播放顺序连续朗读到全文结束 |
| 右键段落 | 从此段第一句开始，并继续后文 |
| 双击句子 | 从此句开始连续朗读 |
| 上一句 / 下一句 / 拖动底部进度条 | 跳转朗读位置，取消旧请求和音频 |
| 滚轮 / 拖动右侧滚动条 / 键盘翻页 | 临时暂停自动跟随，音频继续播放 |
| 回到朗读位置 | 立即定位到当前句并恢复跟随 |
| 语音设置中的恢复时间 | 手动浏览停止后，4 / 8 / 15 / 30 秒恢复；默认 8 秒 |
| 取消自动跟随 | 持续自由浏览，直至重新开启或点击恢复按钮 |
| 字号 / 夜间 / 倍速 | 适合长文阅读；倍速在本机音频播放层调整 |

已播放位置按文件及内容指纹保存在本机，重新打开同一内容时从上次句子继续。代码块、图表不加入朗读队列；普通标题、列表、表格文本会朗读。高亮单位为句子或最多 180 字的长句片段，不伪造字级时间戳。拖动播放进度会改变声音位置，拖动阅读区滚动条仅暂停视图跟随。

## 配置服务

| 服务 | 默认模型 | 默认音色 | 协议 |
| --- | --- | --- | --- |
| 小米 MiMo | `mimo-v2.5-tts` | `mimo_default` | `/v1/chat/completions`，assistant 文本，Base64 WAV |
| 千问 | `qwen3-tts-flash` | `Cherry` | DashScope multimodal-generation，下载 `output.audio.url` |
| OpenAI 兼容 TTS | `tts-1` | `alloy` | `/v1/audio/speech`，二进制 WAV |

MiMo 可填写 `冰糖`、`茉莉`、`苏打`、`白桦` 等官方音色；模型与音色允许手动填写。MiMo 的可选“语气指令”作为 user 消息发送，原文作为 assistant 消息发送。千问默认北京服务，其他区域须修改完整地址并使用相应区域密钥。兼容服务需实际支持 OpenAI 音频合成协议。此版本不支持流式 PCM、声音克隆及 WebSocket realtime 模型。

API Key 通过 Electron `safeStorage` 使用 Windows 系统加密，保存到应用 userData 中的 `tts-settings.json`；不写入项目、不通过设置读取接口返回前端、不输出到日志。更换服务时各服务的密钥分别保留，留空保存会保留该服务原密钥。朗读最多提前请求当前句及后续五句，最多两路合成并发；停止会取消客户端请求，但服务端已受理的合成可能仍计费。

2026-11-14 播放升级：首播先缓冲两句，后续维持最多六句的有界队列；音频返回后立即预加载，切句时复用已准备的播放器，避免每句结束后才开始加载。倍速保持原有保调行为，高亮仍按真实播放位置更新。界面显示已预载句数。当前仍采用完整句音频，尚未接入 SSE / PCM 流式播放；网络持续慢于朗读速度时仍会等待缓冲。实测与回放对比见 [延迟验证记录](docs/TTS-LATENCY-2026-11-14.md)。

## 从源码构建

Node.js >=22.12、pnpm 10。本机附带的 `.tools/package/bin/pnpm.cjs` 可通过 Node 调用，不需要全局安装 pnpm。上游的 `ced` 原生编码检测替换为 MIT 的 `chardet@2.1.1`，避免其 Visual Studio 编译要求。`keytar` 使用官方 N-API Windows 预构建文件；`native-keymap` 为上游可选模块，未编译时使用上游回退行为，非标准键盘布局的快捷键识别可能受影响。

推荐运行 `powershell -ExecutionPolicy Bypass -File .\构建听读.ps1`，自动准备上述工具、依赖和 keytar 预构建并完成编译、类型检查和打包。

```powershell
node .tools/package/bin/pnpm.cjs install --filter marktext... --ignore-scripts --frozen-lockfile
node node_modules/electron/install.js
node .tools/package/bin/pnpm.cjs run build:unpack
node .tools/package/bin/pnpm.cjs run typecheck
node .tools/package/bin/pnpm.cjs -C packages/desktop exec vitest run test/unit/specs/tts.spec.ts
node scripts/package-tts.cjs
```

全新机器仍需准备 `keytar` 官方预构建；本机已经准备。若需编译所有上游原生组件，使用 Visual Studio C++ Build Tools；MinGW 无法直接替代上游 node-gyp 的 MSVC 构建流程。未签名的开发构建可能显示 Windows 来源提示。

## 参考与实现

采用：[MarkText](https://github.com/marktext/marktext)（MIT，2026-11 检出基线）。保留完整应用与 Muya Markdown 渲染器，听读视图直接调用 `MarkdownToHtml.renderHtmlWithHeadings()`，复用 DOMPurify 和 GitHub Markdown 样式，不另写 Markdown 解析器。

参考：[Readest 连续阅读架构](https://github.com/readest/readest/blob/main/apps/readest-app/docs/read-along-narration.md) 与 [阅读器架构](https://github.com/readest/readest/blob/main/apps/readest-app/docs/architecture.md)，用于音频来源、文本切分、播放控制和跟随视图的职责划分；不复制其 AGPL 代码。另参考 MIT 项目 [AIRI 的 MiMo 配置](https://airi.moeru.ai/docs/en/docs/manual/config/providers/speech/mimo)，核对独立语音服务适配思路。

采用：[chardet](https://github.com/runk/node-chardet)（MIT，锁定 2.1.1）。理由是纯 JavaScript 编码检测可避免 ced 的原生构建；通过包管理器集成，保留 UTF-8/BOM 优先处理。

协议依据：[MiMo 官方 TTS API](https://mimo.mi.com/docs/en-US/api/audio/tts-post)、[千问官方 TTS API](https://help.aliyun.com/en/model-studio/qwen-tts-api)。服务端接口可能变化，模型和地址均可配置。

实现入口：`src/main/tts/provider.ts` 处理两家协议及兼容服务；`src/main/ipc/tts.ts` 处理加密配置、超时和按窗口取消；`src/renderer/src/services/tts/` 管理句子映射、有界预取、播放代次和手动跟随；`src/renderer/src/components/tts/Reader.vue` 提供阅读界面。以上路径均相对于 `packages/desktop/`。
