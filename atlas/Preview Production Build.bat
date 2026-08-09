@echo off
setlocal enabledelayedexpansion
title Meridian - Production Preview
cd /d "%~dp0"

echo ==============================================
echo   Meridian - Production Preview (build + serve)
echo ==============================================
echo.
echo This builds the optimized version and serves it,
echo which is also how the offline / installable PWA
echo behaves. Use this to test it like the deployed app.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install it from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies (first run)...
  call npm install
  if errorlevel 1 ( echo [ERROR] npm install failed. & pause & exit /b 1 )
)

echo Building...
call npm run build
if errorlevel 1 ( echo. & echo [ERROR] Build failed. See above. & pause & exit /b 1 )

echo.
echo Build complete. Starting preview server...
echo Keep this window open. Close it to stop the server.
echo.
call npm run preview -- --open

pause
