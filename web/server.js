const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const cron = require("node-cron");
const { getProduceSettings } = require("./produceDatabase");
const {
  checkAndAlert,
  verifyEmailConfig,
  sendTestEmail,
} = require("./emailConfig");
const {
  addMetricToHistory,
  sendReport,
  saveHistoryToFile,
} = require("./reportGenerator");

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

// Prevent caching for HTML files
app.use((req, res, next) => {
  if (
    req.url.endsWith(".html") ||
    req.url === "/" ||
    req.url === "/index.html"
  ) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

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
  type: null, // null, 'apples', 'potatoes'
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

  // Add to report history
  addMetricToHistory(latestMetrics);

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

  if (!produceType || !["apples", "potatoes"].includes(produceType)) {
    return res.status(400).json({
      success: false,
      error: "Invalid produce type. Must be 'apples' or 'potatoes'",
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

// Inventory management with persistence
const inventoryFile = path.join(__dirname, "inventory.json");

// Load inventory from file
function loadInventory() {
  try {
    if (fs.existsSync(inventoryFile)) {
      const data = fs.readFileSync(inventoryFile, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("❌ Error loading inventory:", error);
  }
  return [];
}

// Save inventory to file
function saveInventory(inventory) {
  try {
    fs.writeFileSync(inventoryFile, JSON.stringify(inventory, null, 2));
    console.log("💾 Inventory saved to file");
  } catch (error) {
    console.error("❌ Error saving inventory:", error);
  }
}

let inventory = loadInventory();
console.log(`📦 Loaded ${inventory.length} items from inventory`);

// Get inventory
app.get("/api/inventory", (req, res) => {
  res.json({
    success: true,
    inventory: inventory,
  });
});

// Add inventory item
app.post("/api/inventory/add", (req, res) => {
  const { produceType, quantity, daysLeft } = req.body;

  if (!produceType || !quantity || !daysLeft) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: produceType, quantity, daysLeft",
    });
  }

  const newItem = {
    id: Date.now(),
    type: produceType,
    quantity: parseInt(quantity),
    daysLeft: parseInt(daysLeft),
    addedAt: new Date().toISOString(),
  };

  inventory.push(newItem);
  saveInventory(inventory);
  console.log(`📦 Inventory item added: ${quantity} units of ${produceType}`);

  res.json({
    success: true,
    inventory: inventory,
    item: newItem,
  });
});

// Delete inventory item
app.delete("/api/inventory/delete/:id", (req, res) => {
  const itemId = parseInt(req.params.id);

  const initialLength = inventory.length;
  inventory = inventory.filter((item) => item.id !== itemId);

  if (inventory.length < initialLength) {
    saveInventory(inventory);
    console.log(`🗑️ Inventory item deleted: ID ${itemId}`);

    res.json({
      success: true,
      inventory: inventory,
    });
  } else {
    res.status(404).json({
      success: false,
      error: "Item not found",
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

  // Auto-open browser to login page
  const open = require("open");
  const dashboardUrl = `http://localhost:${PORT}/login.html`;
  console.log(`🚀 Opening login page: ${dashboardUrl}\n`);
  open(dashboardUrl);

  // Schedule automated reports
  setupAutomatedReports();
});

// ============================================
// AUTOMATED REPORT SCHEDULING
// ============================================

function setupAutomatedReports() {
  const emailConfig = require("./emailConfig");
  const recipientEmail = emailConfig.user; // Send to same email

  // Daily report - Every day at 8:00 AM
  cron.schedule("0 8 * * *", async () => {
    console.log("📧 Sending daily automated report...");
    await sendReport("daily", currentProduce, recipientEmail);
  });

  // Weekly report - Every Monday at 9:00 AM
  cron.schedule("0 9 * * 1", async () => {
    console.log("📧 Sending weekly automated report...");
    await sendReport("weekly", currentProduce, recipientEmail);
  });

  console.log("⏰ Automated reports scheduled:");
  console.log("   📅 Daily report: Every day at 8:00 AM");
  console.log("   📅 Weekly report: Every Monday at 9:00 AM");
  console.log(`   📧 Recipient: ${recipientEmail}\n`);
}

// API endpoint to manually trigger a report
app.post("/api/reports/send", async (req, res) => {
  const { type, email } = req.body; // type: 'daily' or 'weekly'

  if (!type || !["daily", "weekly"].includes(type)) {
    return res.status(400).json({
      success: false,
      error: "Invalid report type. Must be 'daily' or 'weekly'",
    });
  }

  const emailConfig = require("./emailConfig");
  const recipientEmail = email || emailConfig.user;

  try {
    const result = await sendReport(type, currentProduce, recipientEmail);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// GRACEFUL SHUTDOWN - Save data before exit
// ============================================

function gracefulShutdown(signal) {
  console.log(`\n⚠️  ${signal} received, shutting down gracefully...`);

  // Save metrics history to file
  console.log("💾 Saving metrics history...");
  saveHistoryToFile();

  console.log("✅ Shutdown complete");
  process.exit(0);
}

// Handle shutdown signals
process.on("SIGINT", () => gracefulShutdown("SIGINT")); // Ctrl+C
process.on("SIGTERM", () => gracefulShutdown("SIGTERM")); // Kill command
process.on("exit", () => {
  console.log("👋 Server stopped");
});
