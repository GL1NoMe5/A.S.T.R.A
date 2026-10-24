@echo off
setlocal
if not exist "%~dp0.venv\Scripts\python.exe" (
  echo Python environment .venv was not found. See README.md for setup.
  pause
  exit /b 2
)
"%~dp0.venv\Scripts\python.exe" -X utf8 "%~dp0scripts\run_local.py" %*
set "astra_exit=%errorlevel%"
if not "%astra_exit%"=="0" if not "%astra_exit%"=="130" pause
exit /b %astra_exit%
