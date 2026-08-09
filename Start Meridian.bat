@echo off
REM Convenience launcher in the project root.
REM It simply forwards to the real launcher inside the "atlas" folder.
cd /d "%~dp0atlas"
call "Start Meridian.bat"
