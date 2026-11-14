const { build, Platform, Arch } = require('electron-builder')
const path = require('node:path')

build({
  projectDir: path.resolve(__dirname, '../packages/desktop'),
  config: { directories: { output: path.resolve(__dirname, '../dist/tts-upgrade') } },
  targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64),
  publish: 'never'
}).catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
