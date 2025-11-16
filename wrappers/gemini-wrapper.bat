@echo off
REM Gemini wrapper for Agent Chatter (Windows)
REM Reads from stdin and passes to gemini CLI

setlocal enabledelayedexpansion

REM Read all input from stdin into a variable
set "prompt="
for /f "delims=" %%i in ('more') do (
    set "prompt=!prompt!%%i"
)

REM Execute gemini with the prompt
gemini -p "%prompt%" 2>nul

REM Add end marker
echo.
echo [DONE]

endlocal
