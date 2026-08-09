@echo off
REM Meridian local sync server. Double-click to run; leave this window open.
REM Your journal syncs to the file in .\data\ on this PC.
cd /d "%~dp0"
echo Starting Meridian sync server...
echo (Close this window to stop syncing. Keep it open while you sync.)
echo.
node sync-server.mjs
pause
