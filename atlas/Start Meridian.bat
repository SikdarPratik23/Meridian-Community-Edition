@echo off
setlocal enabledelayedexpansion
title Meridian Community Edition - A Journal for Geographers
cd /d "%~dp0"

echo ============================================
echo    Meridian Community Edition
echo    A journal for geographers
echo ============================================
echo.

REM --- 1. Check that Node.js (and its bundled npm) is available ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on this computer.
  echo.
  echo Meridian needs Node.js to run. Please install the LTS version from:
  echo     https://nodejs.org/
  echo Then double-click this file again.
  echo If you think you already have Node, test it from a command prompt:
  echo     node --version
  echo If it prints a version, re-run this file. If not, install Node LTS.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on this computer.
  echo.
  echo npm normally comes bundled with Node.js. If "node --version" works but
  echo "npm --version" does not, reinstall the LTS version from:
  echo     https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo Using Node.js !NODE_VER!
echo.

REM --- 2. Install dependencies the first time ---
if not exist "node_modules" (
  echo First-time setup: installing dependencies.
  echo This can take a few minutes. Please wait...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] Installing dependencies failed. Check the messages above.
    pause
    exit /b 1
  )
  echo.
)

REM --- 3. Start the sync server in a separate window (if not already running) ---
netstat -an | findstr /C:":8787 " | findstr /C:"LISTENING" >nul 2>nul
if errorlevel 1 (
  echo Starting Meridian sync server on port 8787...
  pushd "%~dp0..\server"
  start "Meridian Sync Server" cmd /k node sync-server.mjs
  popd
  echo Sync server started -- check its window for your local IP address.
  echo.
) else (
  echo Sync server is already running on port 8787.
  echo.
)

REM --- 4. If Meridian is already running, just open it (don't start a 2nd copy) ---
netstat -an | findstr /C:":5173 " | findstr /C:"LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Meridian is already running. Opening it in your browser...
  start "" "http://localhost:5173"
  echo.
  echo  ^>^>  The server is running in another window. You can close THIS one.
  echo.
  pause
  exit /b 0
)

REM --- 5. Start the dev server and open the browser ---
echo Starting Meridian...
echo A browser tab will open automatically.
echo.
echo  ^>^>  Keep this window open while you use Meridian.
echo  ^>^>  Close this window (or press Ctrl+C) to stop Meridian.
echo  ^>^>  The sync server is in its own window -- close that too when done.
echo.
echo  ^>^>  TO USE MERIDIAN ON YOUR PHONE: look at the "Meridian Sync Server"
echo  ^>^>  window -- it lists the exact address to open on the phone, both for
echo  ^>^>  the same WiFi and for when you are away from home.
echo.

call npm run dev -- --open

echo.
echo Meridian has stopped.
pause
