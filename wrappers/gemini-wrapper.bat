@echo off
REM Gemini wrapper for Agent Chatter (Windows)
REM Reads from stdin and passes to gemini CLI
REM
REM Environment variables:
REM   AGENT_SYSTEM_INSTRUCTION: System prompt to prepend to user message

setlocal enabledelayedexpansion

REM Read all input from stdin into a variable
set "prompt="
for /f "delims=" %%i in ('more') do (
    set "prompt=!prompt!%%i"
)

REM Prepend system instruction if provided
if defined AGENT_SYSTEM_INSTRUCTION (
    set "prompt=[SYSTEM]!AGENT_SYSTEM_INSTRUCTION![MESSAGE]!prompt!"
)

REM Execute gemini with the prompt
gemini -p "%prompt%" 2>nul

REM Add end marker
echo.
echo [DONE]

endlocal
