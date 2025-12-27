# AI Produce Detection System - Setup Guide

## 🎯 System Overview

Your cold storage unit now has AI-powered produce detection that automatically adjusts temperature, humidity, and VOC thresholds based on the type of produce stored. The system uses:

1. **ESP32-CAM** - Captures images of stored produce
2. **YOLO Model** - Identifies produce type (apples, tomatoes, potatoes)
3. **Backend Server** - Coordinates detection and threshold updates
4. **ESP32 Main Unit** - Applies thresholds to control relays
5. **Dashboard** - Displays detected produce and allows manual override

## 📋 Prerequisites

### Hardware
- ✅ ESP32 development board (main sensor unit)
- ✅ ESP32-CAM module (for produce detection)
- ✅ DHT22 temperature/humidity sensor
- ✅ SGP41 VOC sensor
- ✅ 3x relay modules (scrubber, cooling, humidifier)
- ✅ WiFi network

### Software
- ✅ Node.js (v14 or higher)
- ✅ Python 3.8 or higher
- ✅ PlatformIO (for ESP32 programming)

## 🚀 Installation Steps

### Step 1: Install Python Dependencies

```bash
cd "C:\Users\talen\Desktop\Cold storage unit\web"
pip install -r requirements.txt
```

This installs:
- Flask (YOLO inference server)
- Ultralytics (YOLO model)
- OpenCV (image processing)
- NumPy, Pillow (image manipulation)

### Step 2: Train Your YOLO Model

#### Option A: Use Pre-trained Model (Quick Start)
The system will use YOLOv8n as a placeholder. For accurate produce detection, you need to train a custom model.

#### Option B: Train Custom Model (Recommended)

1. **Collect Images**
   - Take 100+ photos of apples in your cold storage
   - Take 100+ photos of tomatoes
   - Take 100+ photos of potatoes
   - Use your ESP32-CAM or smartphone
   - Vary lighting, angles, and quantities

2. **Annotate Images**
   - Use [Roboflow](https://roboflow.com) (free tier available)
   - Upload images
   - Draw bounding boxes around produce
   - Label as: `apples`, `tomatoes`, or `potatoes`
   - Export as YOLO format

3. **Organize Dataset**
```
dataset/
├── train/
│   ├── images/
│   │   ├── apple1.jpg
│   │   ├── tomato1.jpg
│   │   └── ...
│   └── labels/
│       ├── apple1.txt
│       ├── tomato1.txt
│       └── ...
├── val/
│   ├── images/
│   └── labels/
└── data.yaml
```

4. **Create data.yaml**
```yaml
train: ./dataset/train/images
val: ./dataset/val/images
nc: 3
names: ['apples', 'tomatoes', 'potatoes']
```

5. **Train Model**
```bash
pip install ultralytics
yolo train model=yolov8n.pt data=dataset/data.yaml epochs=100 imgsz=640
```

6. **Copy Trained Model**
```bash
copy runs\detect\train\weights\best.pt "C:\Users\talen\Desktop\Cold storage unit\web\produce_model.pt"
```

### Step 3: Start Servers

#### Terminal 1: Start YOLO Inference Server
```bash
cd "C:\Users\talen\Desktop\Cold storage unit\web"
python yolo_server.py
```

Expected output:
```
╔═══════════════════════════════════════╗
║  YOLO Inference Server                ║
║  Cold Storage Produce Detection       ║
╚═══════════════════════════════════════╝

✓ Server starting on port 5000
📊 Endpoints:
   POST /detect - Detect produce from image
   GET  /health - Health check
   GET  /train-info - Training guide

⚙️  Waiting for inference requests...
```

#### Terminal 2: Start Node.js Backend
```bash
cd "C:\Users\talen\Desktop\Cold storage unit\web"
npm start
```

Expected output:
```
╔═══════════════════════════════════════╗
║  Cold Storage Backend Server         ║
╚═══════════════════════════════════════╝

✓ Server running on port 3000

📊 Dashboard: http://localhost:3000
📡 API Endpoint: http://localhost:3000/api/metrics

⚙️  Waiting for ESP32 data...
```

### Step 4: Upload ESP32-CAM Firmware

1. **Connect ESP32-CAM**
   - Connect via FTDI/USB programmer
   - Set IO0 to GND for programming mode
   - Connect 5V, GND, TX, RX

2. **Open PlatformIO**
```bash
cd "C:\Users\talen\Desktop\Cold storage unit\esp32_cam_code"
pio run --target upload
```

3. **Remove IO0 from GND and reset**

4. **Monitor Serial Output**
```bash
pio device monitor
```

Expected output:
```
╔═══════════════════════════════════════╗
║  ESP32-CAM Produce Detection         ║
╚═══════════════════════════════════════╝

📡 Connecting to WiFi: Talent
✓ WiFi connected
📍 IP Address: 172.20.10.x
📷 Initializing camera...
✓ Camera initialized successfully

🚀 ESP32-CAM ready for produce detection

📸 Capturing image...
✓ Image captured: 45234 bytes, 800x600 pixels
📤 Uploading to server... Success! (HTTP 200)
📥 Server response:
{"success":true,"detected":"apples","confidence":0.87,"produce":{...}}
```

### Step 5: Upload ESP32 Main Firmware

1. **Connect main ESP32**
   
2. **Upload firmware**
```bash
cd "C:\Users\talen\Desktop\Cold storage unit\esp32_code"
pio run --target upload
```

3. **Monitor Serial Output**
```bash
pio device monitor
```

You should see threshold updates:
```
✓ Thresholds updated from server:
  Temperature: 0.0–4.0°C
  Humidity: 90.0–95.0%
  VOC: 25000
```

## 🎮 Using the System

### Automatic Mode (AI Detection)

1. ESP32-CAM captures image every 60 seconds
2. Image sent to YOLO server for inference
3. YOLO detects produce type
4. Backend updates thresholds automatically
5. ESP32 fetches new thresholds every 30 seconds
6. Relays adjust based on produce-specific thresholds

### Manual Override

1. Open dashboard: http://localhost:3000
2. Go to "Produce Detection & Selection" section
3. Select produce from dropdown
4. Click "Set" button
5. Thresholds update immediately
6. ESP32 fetches new thresholds on next cycle

## 📊 Produce-Specific Thresholds

### 🍎 Apples
- **Temperature:** 0–4°C
- **Humidity:** 90–95%
- **VOC:** 25 ppm (25000 raw)
- **Ethylene:** Moderate producer
- **Storage:** Up to 6 months

### 🍅 Tomatoes
- **Temperature:** 12–15°C
- **Humidity:** 90–95%
- **VOC:** 20 ppm (20000 raw)
- **Ethylene:** Highly sensitive
- **Storage:** 1-3 weeks

### 🥔 Potatoes
- **Temperature:** 7–10°C
- **Humidity:** 85–90%
- **VOC:** 30 ppm (30000 raw)
- **Ethylene:** Avoid exposure
- **Storage:** 2-4 months

## 🔧 Troubleshooting

### ESP32-CAM Not Connecting to WiFi
```cpp
// Check credentials in esp32_cam_code/src/main.cpp
const char* ssid = "Talent";
const char* password = "talent401";
```

### YOLO Server Not Detecting Produce
- Check if `produce_model.pt` exists
- If not, train custom model or it will use YOLOv8n placeholder
- Ensure good lighting for ESP32-CAM
- Flash LED automatically turns on for better images

### Thresholds Not Updating on ESP32
- Verify Node.js server is running (port 3000)
- Check ESP32 serial output for threshold update messages
- Ensure WiFi connection is stable
- ESP32 updates thresholds every 30 seconds

### Dashboard Not Showing Detected Produce
- Check browser console for errors (F12)
- Verify `/api/metrics` returns produce data
- Clear browser cache and refresh

### Image Upload Failing
```bash
# Check YOLO server is running on port 5000
curl http://localhost:5000/health

# Expected response:
{"status":"healthy","model_loaded":true,"timestamp":"..."}
```

## 🔄 Workflow Diagram

```
ESP32-CAM (every 60s)
    ↓ (capture image)
    ↓ (HTTP POST to /api/upload-image)
Node.js Backend
    ↓ (forward image)
    ↓ (HTTP POST to /detect)
Python YOLO Server
    ↓ (inference)
    ↓ (return detected produce)
Node.js Backend
    ↓ (update thresholds from produceDatabase.js)
    ↓ (serve via /api/thresholds)
ESP32 Main Unit (every 30s)
    ↓ (HTTP GET /api/thresholds)
    ↓ (apply new TEMP_MIN, TEMP_MAX, etc.)
Relay Control
    ↓ (cooling, humidifier, scrubber)
```

## 📝 API Endpoints

### Node.js Backend (Port 3000)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/metrics` | POST | Receive sensor data from ESP32 |
| `/api/metrics` | GET | Get latest sensor data + produce info |
| `/api/produce` | GET | Get current produce settings |
| `/api/produce/set` | POST | Manually set produce type |
| `/api/upload-image` | POST | Upload image from ESP32-CAM |
| `/api/thresholds` | GET | Get current thresholds for ESP32 |

### Python YOLO Server (Port 5000)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/detect` | POST | Detect produce from image |
| `/health` | GET | Health check |
| `/train-info` | GET | Training guide |

## 🎓 Training Tips

1. **Image Quality**
   - Use ESP32-CAM flash for consistent lighting
   - Capture from multiple angles
   - Include different quantities (1 apple, 5 apples, etc.)

2. **Dataset Balance**
   - Equal number of images per class (100+ each)
   - Mix of close-up and wide shots
   - Vary backgrounds

3. **Annotation**
   - Draw tight bounding boxes
   - Label correctly (apples vs tomatoes vs potatoes)
   - Include partially visible produce

4. **Training Parameters**
   - Start with 100 epochs
   - Use imgsz=640 for ESP32-CAM resolution
   - Monitor validation loss

## 🎉 Next Steps

1. **Collect and train custom YOLO model** for accurate detection
2. **Test with real produce** in your cold storage
3. **Monitor system** via dashboard
4. **Adjust thresholds** in produceDatabase.js if needed
5. **Expand to more produce types** by updating database and retraining

## 📞 Support

If you encounter issues:
1. Check serial monitor output from ESP32/ESP32-CAM
2. Check server logs (Node.js and Python)
3. Verify all services are running
4. Ensure WiFi connectivity

---

**System Status Check:**
```bash
# Terminal 1
python yolo_server.py

# Terminal 2
npm start

# Terminal 3
pio device monitor

# Browser
http://localhost:3000
```

All systems operational! 🚀
