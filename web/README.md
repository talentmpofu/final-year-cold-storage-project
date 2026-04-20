# Cold Storage Unit Frontend

A simple, responsive dashboard to monitor temperature, humidity, ethylene, and VOCs, view camera snapshots, see alerts, and interact with mocked controls.

## Structure

```text
web/
  index.html
  assets/
    css/styles.css
    js/app.js
    img/
```

## Run Locally

You can open `web/index.html` directly in your browser, or serve it with a simple static server:

### Option 1: Python (recommended)

```powershell
python -m http.server 8080 -d "C:\\Users\\talen\\Desktop\\Cold storage unit\\web"
```

Open: <http://localhost:8080/>

### Option 2: PowerShell Static Server (Windows 5.1)

```powershell
cd "C:\\Users\\talen\\Desktop\\Cold storage unit\\web"
Start-Process msedge "index.html"; # or chrome/firefox
```

## Next Steps

- Add real-time data via WebSocket/API when backend is ready.
- Replace placeholder camera image with snapshots from the camera module.
- Wire controls to backend endpoints for actuation.
- Add charts for trends (e.g., using a lightweight lib or custom canvas).

## DroidCam Testing Mode

Use this mode when you want higher image quality than ESP32-CAM during testing.
The backend processing remains the same: each uploaded image is sent through
inference and then shown in the dashboard snapshots.

1. Start the backend dashboard server as usual.
1. Start DroidCam on your phone and note its snapshot URL (example:
  `http://192.168.1.50:4747/shot.jpg`).
   If snapshot URL is unavailable, use stream URL:
  `http://192.168.1.50:4747/video`.
1. Install uploader dependency:

```powershell
cd "C:\Users\talen\Desktop\Cold storage unit\web"
pip install requests
```

1. Run periodic image capture and upload:

```powershell
cd "C:\Users\talen\Desktop\Cold storage unit\web"
python droidcam_uploader.py --image-url "http://192.168.1.50:4747/shot.jpg" --interval-seconds 300
```

If your DroidCam setup does not expose a snapshot URL, you can still use stream mode:

```powershell
cd "C:\Users\talen\Desktop\Cold storage unit\web"
python droidcam_uploader.py --stream-url "http://192.168.1.50:4747/video" --interval-seconds 300
```

Notes:

- `300` seconds matches the ESP32-CAM schedule (every 5 minutes) for easier timestamp comparison.
- Uploaded images use the same `/api/upload-image` route as other camera uploads.
- Keep ESP32-CAM as the final embedded validation path.
- If uploader shows "DroidCam is Busy", disconnect/close other DroidCam client sessions first.

## Camo Studio Testing Mode (iPhone Recommended)

Use this mode when DroidCam HTTP endpoints are unavailable or unstable.

1. Open Camo Studio on PC.
1. Connect your iPhone to Camo and enable the virtual camera.
1. Start auto-upload launcher:

```powershell
cd "C:\Users\talen\Desktop\Cold storage unit"
.\start_camo_autoupload.bat
```

The launcher checks for `cv2` and `requests` instead of reinstalling packages
on every run.

1. Enter webcam index:

- Use `1` for the Camo/iPhone camera in your current setup.
- Use `0`, `2`, `3` if you want to test a different camera.

Notes:

- Keep Camo Studio open while uploader runs.
- Uploaded images still go through `/api/upload-image` and Roboflow/local inference as configured.
- Default interval is 300 seconds (5 minutes).
- Windows must detect a Camo virtual camera device; otherwise uploads may come from the built-in webcam.

### One-Click Windows Launcher

From the project root, run:

```powershell
cd "C:\Users\talen\Desktop\Cold storage unit"
.\start_droidcam_autoupload.bat
```

On first run it will ask for your DroidCam image URL and save it to
`droidcam_uploader.local.bat`. Next runs reuse the saved values.
The launcher now validates the snapshot URL before starting uploads and shows
an explicit error if the phone endpoint is unreachable.
You can enter either `.../shot.jpg` or `.../video`; the launcher auto-detects
the mode.

### One-Click Full Startup (Services + DroidCam)

From the project root, run:

```powershell
cd "C:\Users\talen\Desktop\Cold storage unit"
.\start_all.bat
```

This opens two windows automatically:

- Backend services launcher (`start_servers.bat`)
- Camo auto-upload launcher (`start_camo_autoupload.bat`)

## Navigation & Views

- Top navigation links switch between `Dashboard`, `Inventory`, `Analytics`, and `Settings` using a simple hash router.
- Views live in `index.html` with IDs: `view-dashboard`, `view-inventory`, `view-analytics`, `view-settings`.
- Router logic in `assets/js/app.js` controls visibility and active link state.
