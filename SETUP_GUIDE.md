# ESP32 to Web Dashboard Setup Guide

## Step 1: Update ESP32 Configuration

Open `esp32_code/src/main.cpp` and update these lines:

```cpp
// Line 23-24: Your WiFi credentials
const char* ssid = "YOUR_WIFI_SSID";        // Replace with your WiFi name
const char* password = "YOUR_WIFI_PASSWORD"; // Replace with your WiFi password

// Line 27: Your computer's IP address
const char* serverUrl = "http://192.168.1.100:3000/api/metrics";
```

### How to find your computer's IP:

**Windows:**
```powershell
ipconfig
```
Look for "IPv4 Address" under your active network adapter (usually starts with 192.168.x.x)

## Step 2: Install Backend Dependencies

Open PowerShell in the `web` folder:

```powershell
cd "C:\Users\talen\Desktop\Cold storage unit\web"
npm install
```

## Step 3: Start the Backend Server

```powershell
npm start
```

You should see:
```
✓ Server running on port 3000
📊 Dashboard: http://localhost:3000
🌐 Network addresses:
   Ethernet: http://192.168.1.100:3000
```

**Copy the IP address shown** and update it in your ESP32 code (Step 1).

## Step 4: Upload ESP32 Code

1. In VS Code, open PlatformIO
2. Click "Upload" to flash the code to ESP32
3. Open Serial Monitor to see connection status

## Step 5: Access Dashboard

Open your browser to: `http://localhost:3000`

## Troubleshooting

### ESP32 won't connect to WiFi
- Check SSID and password are correct
- Ensure WiFi is 2.4GHz (ESP32 doesn't support 5GHz)
- Check WiFi signal strength

### Dashboard shows no data
- Verify backend server is running
- Check ESP32 Serial Monitor for "✓ Data sent to server"
- Ensure firewall isn't blocking port 3000
- Verify IP address in ESP32 code matches server

### Error sending data from ESP32
- Ping your server IP from another device
- Check both devices are on same network
- Try disabling Windows Firewall temporarily

## Testing

1. Serial Monitor should show:
   ```
   ✓ WiFi connected!
   IP Address: 192.168.1.x
   --- Sensor Readings ---
   Temperature: 20.0 °C (calibrated)
   Humidity: 86.0 %
   ✓ Data sent to server. Response: 200
   ```

2. Dashboard should update every 10 seconds with live data

## Data Flow

```
ESP32 (DHT22) → WiFi → Backend Server (port 3000) → Web Dashboard
     ↓                        ↓                           ↓
  Sensors              Stores data                 Shows live data
```
