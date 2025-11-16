@echo off
REM Codex wrapper for Agent Chatter (Windows)
REM Reads from stdin and passes to codex exec

setlocal enabledelayedexpansion

REM Read all input from stdin into a variable
set "prompt="
for /f "delims=" %%i in ('more') do (
    set "prompt=!prompt!%%i"
)

REM Execute codex with the prompt
codex exec --skip-git-repo-check "%prompt%" 2>nul

REM Add end marker
echo.
echo [DONE]

endlocal
