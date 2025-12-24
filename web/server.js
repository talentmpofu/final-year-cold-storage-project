const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Store latest sensor data
let latestMetrics = {
  temperature: { value: 0 },
  humidity: { value: 0 },
  ethylene: { value: 0.05 },
  vocs: { value: 0 },
  timestamp: new Date().toISOString(),
};

// API endpoint to receive data from ESP32
app.post("/api/metrics", (req, res) => {
  console.log("📥 Received data from ESP32:", req.body);

  // Update stored metrics
  latestMetrics = {
    ...req.body,
    timestamp: new Date().toISOString(),
  };

  res.json({ success: true, message: "Data received" });
});

// API endpoint for web dashboard to fetch data
app.get("/api/metrics", (req, res) => {
  console.log("📤 Sending data to dashboard");
  res.json(latestMetrics);
});

// Serve the dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║  Cold Storage Backend Server         ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log(`\n✓ Server running on port ${PORT}`);
  console.log(`\n📊 Dashboard: http://localhost:${PORT}`);
  console.log(`📡 API Endpoint: http://localhost:${PORT}/api/metrics`);
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
});

