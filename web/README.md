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

## Navigation & Views

- Top navigation links switch between `Dashboard`, `Inventory`, `Analytics`, and `Settings` using a simple hash router.
- Views live in `index.html` with IDs: `view-dashboard`, `view-inventory`, `view-analytics`, `view-settings`.
- Router logic in `assets/js/app.js` controls visibility and active link state.
