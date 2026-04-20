@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "WEB_DIR=%ROOT_DIR%web"
set "CONFIG_FILE=%ROOT_DIR%droidcam_uploader.local.bat"

echo.
echo ===============================================
echo   DroidCam Auto Uploader Launcher
echo ===============================================
echo.

if not exist "%WEB_DIR%\droidcam_uploader.py" (
  echo [ERROR] droidcam_uploader.py not found in %WEB_DIR%
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

echo [1/4] Installing DroidCam uploader dependency (requests)...
pip install requests
if errorlevel 1 (
  echo [ERROR] Failed to install requests.
  pause
  exit /b 1
)

if exist "%CONFIG_FILE%" (
  call "%CONFIG_FILE%"
)

if "%DROIDCAM_CAPTURE_URL%"=="" if not "%DROIDCAM_IMAGE_URL%"=="" (
  set "DROIDCAM_CAPTURE_URL=%DROIDCAM_IMAGE_URL%"
)

if "%DROIDCAM_CAPTURE_URL%"=="" (
  echo.
  echo Enter your DroidCam capture URL
  echo Example snapshot: http://192.168.1.50:4747/shot.jpg
  echo Example stream:   http://192.168.1.50:4747/video
  set /p DROIDCAM_CAPTURE_URL="URL: "
)

if "%DROIDCAM_CAPTURE_URL%"=="" (
  echo [ERROR] No URL provided. Exiting.
  pause
  exit /b 1
)

REM Sanitize pasted URL input (remove accidental quotes and spaces)
set "DROIDCAM_CAPTURE_URL=%DROIDCAM_CAPTURE_URL:\"=%"
set "DROIDCAM_CAPTURE_URL=%DROIDCAM_CAPTURE_URL:'=%"
for /f "tokens=* delims= " %%A in ("%DROIDCAM_CAPTURE_URL%") do set "DROIDCAM_CAPTURE_URL=%%A"

if "%DROIDCAM_INTERVAL_SECONDS%"=="" (
  set "DROIDCAM_INTERVAL_SECONDS=300"
)

set "DROIDCAM_SOURCE_MODE=image"
echo(%DROIDCAM_CAPTURE_URL%| find "/video" >nul
if not errorlevel 1 set "DROIDCAM_SOURCE_MODE=stream"

echo [2/4] Verifying DroidCam snapshot URL...
python -c "import sys,requests; u=r'''%DROIDCAM_CAPTURE_URL%'''; m=r'''%DROIDCAM_SOURCE_MODE%'''; r=requests.get(u, stream=True, timeout=(5,10)); r.raise_for_status(); ct=(r.headers.get('content-type') or '').lower(); chunk=next(r.iter_content(8192), b''); b=len(chunk); ok=(m=='stream' and b>0) or (m=='image' and b>0 and ('image' in ct or u.lower().endswith('.jpg') or u.lower().endswith('.jpeg') or u.lower().endswith('.png'))); print(f'Mode={m} Status={r.status_code} Content-Type={ct or "unknown"} FirstChunkBytes={b}'); sys.exit(0 if ok else 1)"
if errorlevel 1 (
  echo [ERROR] DroidCam capture URL check failed.
  echo        URL : %DROIDCAM_CAPTURE_URL%
  echo        Mode: %DROIDCAM_SOURCE_MODE%
  echo.
  echo Make sure:
  echo   1. Phone and PC are on the same Wi-Fi
  echo   2. DroidCam is running on the phone
  echo   3. URL is correct: /shot.jpg for image mode or /video for stream mode
  echo   4. If /shot.jpg returns 404, use /video instead
  pause
  exit /b 1
)

echo [3/4] Saving launcher settings to:
echo       %CONFIG_FILE%
(
  echo @echo off
  echo REM Local DroidCam uploader settings
  echo set "DROIDCAM_CAPTURE_URL=%DROIDCAM_CAPTURE_URL%"
  echo set "DROIDCAM_SOURCE_MODE=%DROIDCAM_SOURCE_MODE%"
  echo set "DROIDCAM_INTERVAL_SECONDS=%DROIDCAM_INTERVAL_SECONDS%"
) > "%CONFIG_FILE%"

echo [4/4] Starting auto uploader in a new terminal window...
if /I "%DROIDCAM_SOURCE_MODE%"=="stream" (
  start "DroidCam Auto Uploader" /D "%WEB_DIR%" cmd /k "python droidcam_uploader.py --stream-url "%DROIDCAM_CAPTURE_URL%" --interval-seconds %DROIDCAM_INTERVAL_SECONDS%"
) else (
  start "DroidCam Auto Uploader" /D "%WEB_DIR%" cmd /k "python droidcam_uploader.py --image-url "%DROIDCAM_CAPTURE_URL%" --interval-seconds %DROIDCAM_INTERVAL_SECONDS%"
)

echo.
echo Started.
echo - Capture URL: %DROIDCAM_CAPTURE_URL%
echo - Mode      : %DROIDCAM_SOURCE_MODE%
echo - Interval : %DROIDCAM_INTERVAL_SECONDS% seconds
echo.
echo Keep your backend running ^(start_servers.bat^).
echo Press any key to close this launcher.
pause >nul
