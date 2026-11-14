@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "dist\tts-upgrade\win-unpacked\marktext.exe" (
  start "" "dist\tts-upgrade\win-unpacked\marktext.exe" "%~dp0examples\听读示例.md"
) else if exist "dist\win-unpacked\marktext.exe" (
  start "" "dist\win-unpacked\marktext.exe" "%~dp0examples\听读示例.md"
) else (
  start "" "node_modules\electron\dist\electron.exe" "%~dp0packages\desktop" "%~dp0examples\听读示例.md"
)
