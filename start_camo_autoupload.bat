@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "WEB_DIR=%ROOT_DIR%web"
set "CONFIG_FILE=%ROOT_DIR%camo_uploader.local.bat"

echo.
echo ===============================================
echo   Camo Auto Uploader Launcher
echo ===============================================
echo.

if not exist "%WEB_DIR%\camo_uploader.py" (
  echo [ERROR] camo_uploader.py not found in %WEB_DIR%
  pause
  exit /b 1
)

cd /d "%WEB_DIR%"

python --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python is not installed or not in PATH.
  pause
  exit /b 1
)

echo [1/3] Checking Camo uploader dependencies...
python -c "import cv2, requests"
if errorlevel 1 (
  echo [ERROR] Missing Python dependencies ^(cv2/requests^) for Camo uploader.
  echo.
  echo Install once with:
  echo   pip install requests opencv-python
  echo.
  echo If install fails on Python 3.14, use Python 3.12/3.13 for the uploader.
  pause
  exit /b 1
)

set "CAMO_DEVICE_FOUND="
for /f "usebackq delims=" %%L in (`powershell -NoProfile -Command "Get-PnpDevice -Class Camera ^| Select-Object -ExpandProperty FriendlyName"`) do (
  echo %%L | findstr /I "camo" >nul
  if not errorlevel 1 set "CAMO_DEVICE_FOUND=1"
)

if "%CAMO_DEVICE_FOUND%"=="" (
  echo.
  echo [WARNING] No Camo virtual camera device was detected by Windows.
  echo           Current capture is likely to use the built-in webcam.
  echo.
  echo Ensure Camo virtual camera/output is enabled in Camo Studio, then re-run.
  echo.
  set /p CONTINUE_WITHOUT_CAMO="Continue anyway with current camera list? (y/N): "
  if /I not "%CONTINUE_WITHOUT_CAMO%"=="y" (
    echo Exiting so you can enable Camo virtual camera first.
    pause
    exit /b 1
  )
)

if exist "%CONFIG_FILE%" (
  call "%CONFIG_FILE%"
)

if "%CAMO_WEBCAM_INDEX%"=="" set "CAMO_WEBCAM_INDEX=0"
if "%CAMO_WEBCAM_INDEX%"=="-1" set "CAMO_WEBCAM_INDEX=0"

echo.
echo Enter Camo webcam index ^(press Enter to keep %CAMO_WEBCAM_INDEX%^)
set /p CAMO_WEBCAM_INDEX="Index [%CAMO_WEBCAM_INDEX%]: "
if "%CAMO_WEBCAM_INDEX%"=="" set "CAMO_WEBCAM_INDEX=0"
if "%CAMO_WEBCAM_INDEX%"=="-1" set "CAMO_WEBCAM_INDEX=0"

if "%CAMO_INTERVAL_SECONDS%"=="" set "CAMO_INTERVAL_SECONDS=300"

echo [2/3] Saving launcher settings to:
echo       %CONFIG_FILE%
(
  echo @echo off
  echo REM Local Camo uploader settings
  echo set "CAMO_WEBCAM_INDEX=%CAMO_WEBCAM_INDEX%"
  echo set "CAMO_INTERVAL_SECONDS=%CAMO_INTERVAL_SECONDS%"
) > "%CONFIG_FILE%"

echo [3/3] Starting auto uploader in a new terminal window...
start "Camo Auto Uploader" /D "%WEB_DIR%" cmd /k "python camo_uploader.py --webcam-index %CAMO_WEBCAM_INDEX% --interval-seconds %CAMO_INTERVAL_SECONDS%"

echo.
echo Started.
echo - Webcam index: %CAMO_WEBCAM_INDEX%
echo - Interval    : %CAMO_INTERVAL_SECONDS% seconds
echo.
echo Keep Camo Studio open with virtual camera enabled.
echo Keep backend running ^(start_servers.bat^).
echo Press any key to close this launcher.
pause >nul
