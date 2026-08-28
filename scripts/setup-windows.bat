@echo off
setlocal

if defined OPENCODE_LITELLM_SETUP_HELP goto :help

where node >nul 2>nul
if errorlevel 1 goto :missing_node

where npx >nul 2>nul
if errorlevel 1 goto :missing_npx

echo Starting the managed LiteLLM setup for OpenCode and Codex...
call npx --yes @happycastle/opencode-litellm@latest install --target both
exit /b %errorlevel%

:help
echo Usage: scripts\setup-windows.bat
echo.
echo Installs the latest managed LiteLLM configuration for OpenCode and Codex.
echo See docs\windows-setup.md for prerequisites and non-interactive setup.
exit /b 0

:missing_node
echo Node.js is required. Install a supported version and retry. 1>&2
exit /b 1

:missing_npx
echo npx is required. Reinstall Node.js with npm and retry. 1>&2
exit /b 1
