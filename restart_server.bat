@echo off
echo Restarting Cold Storage Server...
echo.
echo Please close any running server instances manually (Ctrl+C in their terminal)
echo Then run this script again to start fresh
echo.
pause
echo.
echo Starting server with email notifications...
cd /d "%~dp0web"
npm start
