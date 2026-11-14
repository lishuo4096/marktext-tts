$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pnpmCli = Join-Path $PSScriptRoot '.tools/package/bin/pnpm.cjs'
if (!(Test-Path -LiteralPath $pnpmCli)) {
  New-Item -ItemType Directory -Force .tools | Out-Null
  $pnpmArchive = Join-Path $env:TEMP 'marktext-pnpm-10.33.4.tgz'
  Invoke-WebRequest 'https://registry.npmjs.org/pnpm/-/pnpm-10.33.4.tgz' -OutFile $pnpmArchive
  tar -xzf $pnpmArchive -C .tools
  if ($LASTEXITCODE) { throw 'pnpm 解包失败' }
}
node $pnpmCli install --filter marktext... --ignore-scripts --frozen-lockfile
if ($LASTEXITCODE) { throw '依赖安装失败' }
if (!(Test-Path 'node_modules/electron/dist/electron.exe')) {
  node node_modules/electron/install.js
  if ($LASTEXITCODE) {
    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
    node node_modules/electron/install.js
    if ($LASTEXITCODE) { throw 'Electron 下载失败' }
  }
}
if (!(Test-Path 'packages/desktop/node_modules/keytar/build/Release/keytar.node')) {
  $keytarArchive = Join-Path $env:TEMP 'marktext-keytar-7.9.0.tgz'
  Invoke-WebRequest 'https://github.com/atom/node-keytar/releases/download/v7.9.0/keytar-v7.9.0-napi-v3-win32-x64.tar.gz' -OutFile $keytarArchive
  tar -xzf $keytarArchive -C packages/desktop/node_modules/keytar
  if ($LASTEXITCODE) { throw 'keytar 解包失败' }
}
node $pnpmCli run build:unpack
if ($LASTEXITCODE) { throw '编译失败' }
node $pnpmCli run typecheck
if ($LASTEXITCODE) { throw '类型检查失败' }
node scripts/package-tts.cjs
if ($LASTEXITCODE) { throw '打包失败' }
Write-Host '完成：dist/tts-upgrade/win-unpacked/marktext.exe'
