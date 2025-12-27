@echo off
REM Cold Storage AI System - Quick Start Script
REM This script starts both servers required for AI produce detection

echo.
echo ╔═══════════════════════════════════════╗
echo ║  Cold Storage AI System Launcher      ║
echo ╚═══════════════════════════════════════╝
echo.

cd /d "%~dp0web"

echo [1/2] Checking Python dependencies...
python --version >nul 2>&1
if errorlevel 1 (
    echo ✗ Python not found! Please install Python 3.8+
    pause
    exit /b 1
)

echo [2/2] Checking Node.js dependencies...
node --version >nul 2>&1
if errorlevel 1 (
    echo ✗ Node.js not found! Please install Node.js 14+
    pause
    exit /b 1
)

echo.
echo ✓ Prerequisites OK
echo.
echo Starting services...
echo.

REM Start YOLO server in new window
echo [Starting YOLO Inference Server on port 5000]
start "YOLO Inference Server" cmd /k "cd /d %cd% && python yolo_server.py"

REM Wait for YOLO server to initialize
timeout /t 3 /nobreak >nul

REM Start Node.js backend in new window
echo [Starting Node.js Backend on port 3000]
start "Node.js Backend" cmd /k "cd /d %cd% && npm start"

echo.
echo ╔═══════════════════════════════════════╗
echo ║  Services Started!                    ║
echo ╚═══════════════════════════════════════╝
echo.
echo 📊 Dashboard: http://localhost:3000
echo 🤖 YOLO API: http://localhost:5000
echo.
echo ⚙️  Two terminal windows opened:
echo    1. YOLO Inference Server (Python)
echo    2. Node.js Backend Server
echo.
echo 💡 Next steps:
echo    1. Upload ESP32-CAM firmware
echo    2. Upload ESP32 main firmware
echo    3. Open dashboard in browser
echo.
echo Press any key to exit launcher...
pause >nul
