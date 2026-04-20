@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"

echo.
echo ===============================================
echo   Cold Storage + Camo One-Click Start
echo ===============================================
echo.

echo [1/2] Starting backend services...
start "Cold Storage Services" cmd /k "cd /d ""%ROOT_DIR%"" && start_servers.bat"

echo [2/2] Starting Camo auto-upload launcher...
start "Camo Auto Upload" cmd /k "cd /d ""%ROOT_DIR%"" && start_camo_autoupload.bat"

echo.
echo Started both launchers in separate windows.
echo.
echo If this is your first run, complete the Camo webcam index prompt in the uploader window.
echo Press any key to close this window.
pause >nul
