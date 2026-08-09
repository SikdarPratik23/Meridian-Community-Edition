@echo off
REM Pick the folder where Meridian keeps your journal data, then remember it.
REM Double-click this, choose a folder, and restart Meridian.
cd /d "%~dp0"
title Meridian - Choose Data Folder

echo ============================================
echo   Meridian - Choose your data folder
echo ============================================
echo.
echo A folder-picker window will open. Choose where you want
echo Meridian to store your journal (e.g. Documents, a USB
echo drive, or a OneDrive/Drive folder).
echo.

REM Open a native Windows folder picker and capture the chosen path.
set "PICKED="
for /f "delims=" %%i in ('powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose where Meridian stores your journal data'; $d.ShowNewFolderButton=$true; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){ Write-Output $d.SelectedPath }"') do set "PICKED=%%i"

if not defined PICKED (
  echo No folder chosen. Nothing was changed.
  echo.
  pause
  exit /b 0
)

echo You chose: %PICKED%
echo.
node set-data-folder.mjs "%PICKED%"

pause
