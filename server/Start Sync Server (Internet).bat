@echo off
REM ============================================================================
REM  Meridian sync server + Tailscale HTTPS
REM  Same as "Start Sync Server.bat", but ALSO makes this PC reachable from your
REM  phone anywhere in the world (or on the same WiFi) over a secure HTTPS link,
REM  using Tailscale. Your data still lives ONLY on this PC — Tailscale is just an
REM  encrypted pipe between your own devices, not a cloud that stores anything.
REM
REM  First-time setup: see TAILSCALE-SETUP.md (one toggle in the Tailscale admin
REM  console, plus installing Tailscale on your phone).
REM ============================================================================
cd /d "%~dp0"

set "TS=C:\Program Files\Tailscale\tailscale.exe"
if not exist "%TS%" set "TS=tailscale"

echo.
echo  Opening a secure HTTPS door for your phone (via Tailscale)...
"%TS%" serve --bg 8787
if errorlevel 1 (
  echo.
  echo  [!] Could not start the Tailscale HTTPS proxy.
  echo      - Is Tailscale running and signed in?
  echo      - Is "HTTPS Certificates" enabled in the admin console?
  echo      See TAILSCALE-SETUP.md for the fix. The server will still start below
  echo      for same-WiFi sync using the http://192.168.x.x address.
  echo.
) else (
  echo.
  echo  Your phone can reach this PC at:
  echo.
  "%TS%" serve status
  echo.
)

echo  Starting Meridian sync server...
echo  (Close this window to stop syncing. Keep it open while you sync.)
echo.
node sync-server.mjs
pause
