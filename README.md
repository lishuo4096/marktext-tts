# MarkText TTS

基于 [MarkText](https://github.com/marktext/marktext) 的 Markdown 桌面听读应用，支持千问、MiMo 和 OpenAI 兼容 TTS API，提供小说式连续朗读、句级高亮和可打断的自动滚动。

An MIT-licensed MarkText derivative for reading Markdown aloud with Qwen, Xiaomi MiMo and OpenAI-compatible TTS services. Includes continuous narration, sentence highlighting, buffered playback and interruptible scroll following.

## 项目介绍

MarkText TTS 是一款面向长篇小说和 Markdown 文档的桌面听读器。在保留 MarkText 编辑与阅读体验的基础上，它接入千问、MiMo 和 OpenAI 兼容语音合成服务，让本地 Markdown 文件可以连续朗读，同时标出当前句子并滚动跟随。

听读时可以自由浏览其他段落：滚轮或拖动滚动条会暂时暂停视图跟随，声音继续播放；点击恢复按钮即可回到朗读位置。也可以右键从某段开始、双击从某句开始，或通过进度条跳转。多句预取和音频预加载用于减少短句与长句交替时的等待，适合边听边看、检查自己写的小说或阅读长文。

应用使用用户配置的云端 TTS API，不捆绑本地大模型。项目以 MIT 许可证开放源码，支持 Windows 本机构建；当前版本的接口能力、验证范围和限制见下文。

## 当前功能

- 保留 MarkText 的 Markdown 编辑、文件打开、保存、目录与主题能力。
- 支持 MiMo、千问和 OpenAI 兼容语音合成接口；各服务的 API Key 分别加密保存。
- 按句连续朗读；最多六句在途/缓存、两路合成并发、首播两句缓冲。
- 音频提前加载，切句复用已准备的播放器；暂停、继续、停止和倍速。
- 当前句高亮；自动滚动跟随；滚轮、拖动滚动条或键盘翻页后临时暂停跟随。
- 右键从此段开始、双击从此句开始、拖动播放进度跳转。
- 日间/夜间、字号调整、按文档内容记忆朗读位置。

当前版本采用完整句音频合成，**尚未实现 SSE / PCM 流式播放、语义分块或大模型导演**。模型支持流式并不表示本应用已经接入。千问和 OpenAI 兼容适配已实现；真实接口验证主要使用 MiMo。

## Windows 构建与运行

需要 Node.js >=22.12、Git、Windows x64 和可访问 npm / GitHub 的网络。进入源码目录后运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\构建听读.ps1
.\启动听读.cmd
```

脚本会准备项目内 pnpm、依赖、Electron 和 keytar 官方预构建文件，再编译、检查类型和打包。产物位于 `dist/tts-upgrade/win-unpacked/marktext.exe`，复制到其他机器时需携带整个 `win-unpacked` 目录。更换版本前先退出旧版，以免单实例机制将文件转交给旧进程。

此仓库发布源码；构建产物、依赖目录、工具缓存与个人配置不提交。默认依赖安装流程沿用上游原生模块重建逻辑，Windows 听读版建议使用专用构建脚本。MinGW 不能直接替代上游 node-gyp 的 MSVC 构建流程。

打开文档后点击右下角“阅读与朗读”，在“语音设置”中填写完整 API 地址、模型、音色和密钥，保存后开始朗读。附带原创 [听读示例](examples/听读示例.md)。

## 配置与隐私

| 服务 | 默认模型 | 默认音色 |
| --- | --- | --- |
| 小米 MiMo | `mimo-v2.5-tts` | `mimo_default` |
| 千问 | `qwen3-tts-flash` | `Cherry` |
| OpenAI 兼容 TTS | `tts-1` | `alloy` |

密钥通过 Electron `safeStorage` 使用操作系统加密，存放在应用 userData 的 `tts-settings.json`，不纳入仓库。朗读会向所选服务发送当前句与预取片段；停止会取消客户端请求，但已受理的请求可能仍产生费用。

API Key 按服务保存；地址、模型、音色与语气指令目前只保存当前一套，尚无完整的多模型命名预设。更换区域时需使用对应区域的地址与密钥。本版本尚无文本模型语义分析功能。

## 验证与文档

- 11 项 TTS 单元测试通过，覆盖分句映射、协议、缓存上限、并发、暂停、跳段和未来请求失败。
- 类型检查及生产构建通过；ESLint 为 0 错误，保留上游及非空断言警告。
- 源码构建与 Windows 发布产物的连续朗读、滚动跟随及跳转交互验证通过。
- [详细使用和开发说明](README-TTS.md)
- [播放延迟测量与优化记录](docs/TTS-LATENCY-2026-11-14.md)
- [初版验证记录](docs/TTS-VALIDATION.md)
- [上游 MarkText README](README.marktext.md)

开发环境执行 TTS 测试：

```powershell
node .tools/package/bin/pnpm.cjs -C packages/desktop exec vitest run test/unit/specs/tts.spec.ts
```

## 许可证与来源

项目采用 [MIT License](LICENSE)，保留 Luo Ran 与 MarkText Contributors 的原有版权声明，并补充听读版修改的版权归属。上游源码基线为 `f3b15b9411a98eb6008cb2d3e399044ed1fb172e`，这是独立的听读派生版本。

听读实现参考 Readest 的架构文档与 AIRI 的 MiMo 配置文档，没有复制 Readest 的 AGPL 代码。Muya、DOMPurify、GitHub Markdown CSS 及其他依赖保留各自许可证，详见上游文件与依赖包中的授权信息。
