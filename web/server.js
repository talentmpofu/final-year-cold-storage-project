const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const { getProduceSettings } = require("./produceDatabase");
const {
  checkAndAlert,
  verifyEmailConfig,
  sendTestEmail,
} = require("./emailConfig");

// Load environment variables
require("dotenv").config();

// Create snapshots directory if it doesn't exist
const snapshotsDir = path.join(__dirname, "snapshots");
if (!fs.existsSync(snapshotsDir)) {
  fs.mkdirSync(snapshotsDir);
}

const app = express();
const PORT = 3000;

// Configure file upload
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use("/snapshots", express.static(snapshotsDir));

// Store latest sensor data
let latestMetrics = {
  temperature: { value: 0 },
  humidity: { value: 0 },
  vocs: { value: 0 },
  timestamp: new Date().toISOString(),
};

// Store current produce and thresholds
let currentProduce = {
  type: null, // null, 'apples', 'tomatoes', 'potatoes'
  detectedAt: null,
  manualOverride: false,
  thresholds: {
    temperature: { min: 0, max: 4 },
    humidity: { min: 90, max: 95 },
    voc: 30000,
  },
};

// API endpoint to receive data from ESP32
app.post("/api/metrics", (req, res) => {
  console.log("📥 Received data from ESP32:", req.body);

  // Update stored metrics
  latestMetrics = {
    ...req.body,
    timestamp: new Date().toISOString(),
  };

  // Check thresholds and send alerts if needed
  checkAndAlert(latestMetrics, currentProduce.thresholds, currentProduce.type);

  res.json({ success: true, message: "Data received" });
});

// API endpoint for web dashboard to fetch data
app.get("/api/metrics", (req, res) => {
  console.log("📤 Sending data to dashboard");
  res.json({
    ...latestMetrics,
    produce: currentProduce,
  });
});

// API endpoint to get current produce settings
app.get("/api/produce", (req, res) => {
  res.json(currentProduce);
});

// API endpoint to manually set produce type
app.post("/api/produce/set", (req, res) => {
  const { produceType } = req.body;

  if (
    !produceType ||
    !["apples", "tomatoes", "potatoes"].includes(produceType)
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Invalid produce type. Must be 'apples', 'tomatoes', or 'potatoes'",
    });
  }

  const settings = getProduceSettings(produceType);
  if (!settings) {
    return res.status(404).json({
      success: false,
      error: "Produce settings not found",
    });
  }

  currentProduce = {
    type: produceType,
    detectedAt: new Date().toISOString(),
    manualOverride: true,
    thresholds: {
      temperature: settings.temp,
      humidity: settings.humidity,
      voc: settings.voc,
    },
  };

  console.log(`🍎 Produce manually set to: ${produceType}`);
  console.log(`📊 New thresholds:`, currentProduce.thresholds);

  res.json({
    success: true,
    produce: currentProduce,
  });
});

// Get latest snapshot image
app.get("/api/latest-snapshot", (req, res) => {
  try {
    const files = fs
      .readdirSync(snapshotsDir)
      .filter((file) => file.endsWith(".jpg"))
      .map((file) => ({
        name: file,
        path: path.join(snapshotsDir, file),
        time: fs.statSync(path.join(snapshotsDir, file)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 0) {
      res.json({
        success: true,
        snapshot: `/snapshots/${files[0].name}`,
        timestamp: files[0].time,
      });
    } else {
      res.json({
        success: false,
        message: "No snapshots available yet",
      });
    }
  } catch (error) {
    console.error("❌ Error getting latest snapshot:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all snapshots
app.get("/api/snapshots", (req, res) => {
  try {
    const files = fs
      .readdirSync(snapshotsDir)
      .filter((file) => file.endsWith(".jpg"))
      .map((file) => ({
        name: file,
        url: `/snapshots/${file}`,
        timestamp: fs.statSync(path.join(snapshotsDir, file)).mtime.getTime(),
      }))
      .sort((a, b) => b.timestamp - a.timestamp);

    res.json({
      success: true,
      snapshots: files,
    });
  } catch (error) {
    console.error("❌ Error getting snapshots:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to upload image from ESP32-CAM
app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No image file provided",
      });
    }

    console.log("📸 Image received from ESP32-CAM:", req.file.originalname);

    // Save image to snapshots folder
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const savedImagePath = path.join(snapshotsDir, `snapshot_${timestamp}.jpg`);
    fs.copyFileSync(req.file.path, savedImagePath);
    console.log(`💾 Image saved to: ${savedImagePath}`);

    // Call Python YOLO inference API
    try {
      const formData = new FormData();
      formData.append("image", fs.createReadStream(req.file.path));

      const yoloResponse = await axios.post(
        "http://localhost:5000/detect",
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 10000, // 10 second timeout
        }
      );

      const { detected, confidence } = yoloResponse.data;

      console.log(
        `🤖 YOLO detected: ${detected || "nothing"} (confidence: ${(
          confidence * 100
        ).toFixed(1)}%)`
      );

      // Only update if produce was detected with good confidence and no manual override
      if (detected && confidence > 0.5 && !currentProduce.manualOverride) {
        const settings = getProduceSettings(detected);
        if (settings) {
          currentProduce = {
            type: detected,
            detectedAt: new Date().toISOString(),
            manualOverride: false,
            confidence: confidence,
            thresholds: {
              temperature: settings.temp,
              humidity: settings.humidity,
              voc: settings.voc,
            },
          };

          console.log(
            `📊 Auto-adjusted thresholds for ${detected}:`,
            currentProduce.thresholds
          );
        }
      }

      res.json({
        success: true,
        detected: detected,
        confidence: confidence,
        produce: currentProduce,
      });
    } catch (yoloError) {
      console.error("⚠️  YOLO API error:", yoloError.message);

      // Fallback: continue without detection
      res.json({
        success: true,
        detected: null,
        error: "YOLO service unavailable",
        produce: currentProduce,
      });
    } finally {
      // Clean up uploaded file
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Error deleting temp file:", err);
      });
    }
  } catch (error) {
    console.error("❌ Error processing image:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API endpoint to get thresholds for ESP32
app.get("/api/thresholds", (req, res) => {
  res.json({
    temperature: currentProduce.thresholds.temperature,
    humidity: currentProduce.thresholds.humidity,
    voc: currentProduce.thresholds.voc,
  });
});

// Test email endpoint
app.post("/api/test-email", async (req, res) => {
  console.log("📧 Testing email configuration...");

  const isConfigured = await verifyEmailConfig();
  if (!isConfigured) {
    return res.status(500).json({
      success: false,
      error: "Email not configured. Check server logs and .env file",
    });
  }

  const sent = await sendTestEmail();
  if (sent) {
    res.json({
      success: true,
      message: "Test email sent successfully! Check your inbox.",
    });
  } else {
    res.status(500).json({
      success: false,
      error: "Failed to send test email. Check server logs for details.",
    });
  }
});

// Trigger manual alert for testing
app.post("/api/test-alert", async (req, res) => {
  const { alertType } = req.body;

  if (!["temperature", "humidity", "voc"].includes(alertType)) {
    return res.status(400).json({
      success: false,
      error: "Invalid alert type. Must be 'temperature', 'humidity', or 'voc'",
    });
  }

  const { sendAlert } = require("./emailConfig");

  // Create test alert data
  const testData = {
    temperature: {
      current: 15.5,
      min: 0,
      max: 4,
      produceType: currentProduce.type || "Test",
    },
    humidity: {
      current: 50,
      min: 90,
      max: 95,
      produceType: currentProduce.type || "Test",
    },
    voc: {
      current: 50000,
      max: 30000,
      produceType: currentProduce.type || "Test",
    },
  };

  try {
    await sendAlert(alertType, testData[alertType]);
    res.json({
      success: true,
      message: `Test ${alertType} alert sent successfully!`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Serve the dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║  Cold Storage Backend Server         ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log(`\n✓ Server running on port ${PORT}`);
  console.log(`\n📊 Dashboard: http://localhost:${PORT}`);
  console.log(`📡 API Endpoint: http://localhost:${PORT}/api/metrics`);

  // Verify email configuration on startup
  console.log(`\n📧 Verifying email configuration...`);
  await verifyEmailConfig();

  console.log(`\n⚙️  Waiting for ESP32 data...\n`);

  // Get local IP address
  const os = require("os");
  const networkInterfaces = os.networkInterfaces();
  console.log("🌐 Network addresses:");
  Object.keys(networkInterfaces).forEach((interfaceName) => {
    networkInterfaces[interfaceName].forEach((iface) => {
      if (iface.family === "IPv4" && !iface.internal) {
        console.log(`   ${interfaceName}: http://${iface.address}:${PORT}`);
      }
    });
  });
  console.log("\n");

  // Auto-open browser to dashboard
  const open = require("open");
  const dashboardUrl = `http://localhost:${PORT}/index.html#dashboard`;
  console.log(`🚀 Opening dashboard: ${dashboardUrl}\n`);
  open(dashboardUrl);
});
