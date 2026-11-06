@echo off
rem Zhigao review desk - local launcher. Listens on 127.0.0.1 only.
cd /d "%~dp0"
set PORT=8765
set "PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" --version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python 3 was not found. Install Python 3 and tick "Add to PATH", then run this file again.
  pause
  exit /b 1
)
echo Starting Zhigao review desk ...
echo Open in Edge or Chrome:  http://127.0.0.1:%PORT%/
echo Keep this window open while you work. Closing it stops the desk; your data stays in the browser.
start "" "http://127.0.0.1:%PORT%/"
"%PY%" -m http.server %PORT% --bind 127.0.0.1
echo.
echo [STOPPED] The server exited. If port %PORT% is in use, edit this file and change PORT=8765 to 8766.
pause
