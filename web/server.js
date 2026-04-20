const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const sharp = require("sharp");
const cron = require("node-cron");
const PDFDocument = require("pdfkit");
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
  getMetricsHistory,
} = require("./reportGenerator");

// Load environment variables
require("dotenv").config();

// Create snapshots directory if it doesn't exist
const snapshotsDir = path.join(__dirname, "snapshots");
if (!fs.existsSync(snapshotsDir)) {
  fs.mkdirSync(snapshotsDir);
}
const snapshotsMetaPath = path.join(snapshotsDir, "snapshots_meta.json");

const app = express();
const PORT = 3000;

// Inference provider config
const INFERENCE_PROVIDER = String(
  process.env.INFERENCE_PROVIDER || "local",
).toLowerCase();
const LOCAL_INFERENCE_URL =
  process.env.LOCAL_INFERENCE_URL || "http://localhost:5000/detect";
const ROBOFLOW_API_BASE =
  process.env.ROBOFLOW_API_BASE || "https://detect.roboflow.com";
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || "";
const ROBOFLOW_PROJECT = process.env.ROBOFLOW_PROJECT || "";
const ROBOFLOW_VERSION = process.env.ROBOFLOW_VERSION || "";
const ROBOFLOW_CONFIDENCE = Number(process.env.ROBOFLOW_CONFIDENCE || 50);
const ROBOFLOW_OVERLAP = Number(process.env.ROBOFLOW_OVERLAP || 50);
const NORMALIZED_IMAGE_SIZE = 640;

function loadSnapshotsMeta() {
  try {
    if (!fs.existsSync(snapshotsMetaPath)) return {};
    const raw = fs.readFileSync(snapshotsMetaPath, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("⚠️  Failed to read snapshot metadata:", error.message);
    return {};
  }
}

function saveSnapshotsMeta(meta) {
  try {
    fs.writeFileSync(snapshotsMetaPath, JSON.stringify(meta, null, 2), "utf8");
  } catch (error) {
    console.error("⚠️  Failed to save snapshot metadata:", error.message);
  }
}

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

// Latest AI quality alerts derived from camera detections.
// Alerts are informational only and auto-clear when spoilage is no longer detected.
let latestAIQualityAlerts = [];

let latestCameraInventorySummary = {
  totalApples: 0,
  totalPotatoes: 0,
  applesGood: 0,
  applesBad: 0,
  potatoesGood: 0,
  potatoesBad: 0,
  analyzedAt: null,
};

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[,"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function resolveRange(range) {
  const normalized = String(range || "24h").toLowerCase();
  if (normalized === "7d") return { key: "7d", hours: 7 * 24 };
  if (normalized === "30d") return { key: "30d", hours: 30 * 24 };
  return { key: "24h", hours: 24 };
}

function buildHistoryRows(cutoff = null) {
  const cutoffMs = Number.isFinite(cutoff) ? cutoff : null;
  return (getMetricsHistory() || [])
    .map((m) => ({
      timestamp: new Date(m.timestamp).getTime(),
      temperature: Number(m.temperature || 0),
      humidity: Number(m.humidity || 0),
      voc: Number(m.voc || 0),
    }))
    .filter(
      (m) =>
        Number.isFinite(m.timestamp) &&
        (cutoffMs === null || m.timestamp >= cutoffMs),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function getFilteredHistory(range) {
  const resolved = resolveRange(range);
  const cutoff = Date.now() - resolved.hours * 60 * 60 * 1000;
  const rows = buildHistoryRows(cutoff);

  return { resolved, rows };
}

function getAllHistoryRows() {
  return buildHistoryRows();
}

function metricStats(values) {
  if (!values.length) {
    return { min: 0, max: 0, avg: 0, current: 0, trend: "stable" };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
  const current = values[values.length - 1];
  const first = values[0];
  const delta = current - first;
  const trend =
    Math.abs(delta) < 0.01 ? "stable" : delta > 0 ? "rising" : "falling";

  return { min, max, avg, current, trend };
}

function getMetricStatus(metric, value, thresholds) {
  if (metric === "temperature") {
    if (value < thresholds.temperature.min) return "below-range";
    if (value > thresholds.temperature.max) return "above-range";
    return "safe";
  }
  if (metric === "humidity") {
    if (value < thresholds.humidity.min) return "below-range";
    if (value > thresholds.humidity.max) return "above-range";
    return "safe";
  }
  if (value > thresholds.voc) return "above-threshold";
  return "safe";
}

function downsampleRows(rows = [], maxPoints = 240) {
  if (rows.length <= maxPoints) return rows;
  const stride = rows.length / maxPoints;
  const sampled = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(rows.length - 1, Math.floor(i * stride));
    sampled.push(rows[idx]);
  }
  return sampled;
}

function normalizeDetectionLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function getProduceTypeFromLabel(label) {
  const normalized = normalizeDetectionLabel(label);
  if (normalized.includes("apple")) return "apples";
  if (normalized.includes("potato")) return "potatoes";
  return null;
}

function isBadQualityLabel(label) {
  const normalized = normalizeDetectionLabel(label);
  return /bad|rotten|rot|overripe|over_ripen|spoiled|spoilage/.test(normalized);
}

function getDetectionColor(label) {
  return isBadQualityLabel(label)
    ? { stroke: "#ff2d55", fill: "#ff2d55" }
    : { stroke: "#22c55e", fill: "#22c55e" };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeSvgText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function annotateSnapshotImage(
  imagePath,
  detections = [],
  width = NORMALIZED_IMAGE_SIZE,
  height = NORMALIZED_IMAGE_SIZE,
) {
  if (!Array.isArray(detections) || detections.length === 0) {
    return;
  }

  const items = detections
    .map((d) => {
      const bbox = Array.isArray(d?.bbox) ? d.bbox : [0, 0, 0, 0];
      const x1 = clamp(Number(bbox[0] || 0), 0, width);
      const y1 = clamp(Number(bbox[1] || 0), 0, height);
      const x2 = clamp(Number(bbox[2] || 0), 0, width);
      const y2 = clamp(Number(bbox[3] || 0), 0, height);
      const boxW = Math.max(1, x2 - x1);
      const boxH = Math.max(1, y2 - y1);

      const label = `${normalizeDetectionLabel(d?.type || "unknown")} ${Math.round(
        Number(d?.confidence || 0) * 100,
      )}%`;
      const safeLabel = escapeSvgText(label);
      const { stroke, fill } = getDetectionColor(d?.type);
      const labelW = Math.max(84, label.length * 7 + 10);
      const labelH = 22;
      const labelX = clamp(x1, 0, Math.max(0, width - labelW));
      const labelY = y1 >= labelH + 2 ? y1 - labelH : y1 + 2;

      return `
        <rect x="${x1}" y="${y1}" width="${boxW}" height="${boxH}" fill="none" stroke="${stroke}" stroke-width="2"/>
        <rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" rx="2" ry="2" fill="${fill}"/>
        <text x="${labelX + 6}" y="${labelY + 15}" fill="#ffffff" font-size="15" font-family="Arial, sans-serif" font-weight="700">${safeLabel}</text>
      `;
    })
    .join("\n");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${items}</svg>`;
  const tempPath = imagePath.replace(/\.jpg$/i, "_annotated_tmp.jpg");

  await sharp(imagePath)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toFile(tempPath);

  fs.renameSync(tempPath, imagePath);
}

function mapRoboflowPredictionsToDetections(predictions = []) {
  return predictions.map((p) => {
    const label = normalizeDetectionLabel(p.class || p.label || p.type);
    const confidence = Number(p.confidence || 0);

    // Roboflow commonly returns center-based x/y/width/height values.
    const x = Number(p.x || 0);
    const y = Number(p.y || 0);
    const width = Number(p.width || 0);
    const height = Number(p.height || 0);
    const x1 = x - width / 2;
    const y1 = y - height / 2;
    const x2 = x + width / 2;
    const y2 = y + height / 2;

    return {
      type: label,
      confidence,
      bbox: [x1, y1, x2, y2],
    };
  });
}

function pickTopProduceDetection(detections = []) {
  let detected = null;
  let confidence = 0;

  detections.forEach((d) => {
    const produceType = getProduceTypeFromLabel(d.type);
    if (produceType && Number(d.confidence || 0) > confidence) {
      detected = d.type;
      confidence = Number(d.confidence || 0);
    }
  });

  return { detected, confidence };
}

async function runLocalInference(imagePath) {
  const formData = new FormData();
  formData.append("image", fs.createReadStream(imagePath));

  const yoloResponse = await axios.post(LOCAL_INFERENCE_URL, formData, {
    headers: formData.getHeaders(),
    timeout: 10000,
  });

  return {
    provider: "local",
    detected: yoloResponse.data?.detected || null,
    confidence: Number(yoloResponse.data?.confidence || 0),
    all_detections: yoloResponse.data?.all_detections || [],
  };
}

async function runRoboflowInference(imagePath) {
  if (!ROBOFLOW_API_KEY || !ROBOFLOW_PROJECT || !ROBOFLOW_VERSION) {
    throw new Error(
      "Roboflow is selected but ROBOFLOW_API_KEY, ROBOFLOW_PROJECT, or ROBOFLOW_VERSION is missing.",
    );
  }

  const formData = new FormData();
  formData.append("file", fs.createReadStream(imagePath));

  const endpoint = `${ROBOFLOW_API_BASE}/${ROBOFLOW_PROJECT}/${ROBOFLOW_VERSION}?api_key=${encodeURIComponent(ROBOFLOW_API_KEY)}&confidence=${encodeURIComponent(ROBOFLOW_CONFIDENCE)}&overlap=${encodeURIComponent(ROBOFLOW_OVERLAP)}`;

  const response = await axios.post(endpoint, formData, {
    headers: formData.getHeaders(),
    timeout: 15000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const predictions = Array.isArray(response.data?.predictions)
    ? response.data.predictions
    : [];

  const detections = mapRoboflowPredictionsToDetections(predictions);
  const top = pickTopProduceDetection(detections);

  return {
    provider: "roboflow",
    detected: top.detected,
    confidence: top.confidence,
    all_detections: detections,
  };
}

async function runInference(imagePath) {
  if (INFERENCE_PROVIDER === "roboflow") {
    return runRoboflowInference(imagePath);
  }
  return runLocalInference(imagePath);
}

function buildAIQualityAlertsFromDetections(detections = []) {
  const spoilageDetections = detections.filter((d) => {
    return isBadQualityLabel(d.type);
  });

  if (!spoilageDetections.length) {
    return [];
  }

  const produceCounts = spoilageDetections.reduce((acc, d) => {
    const produce = getProduceTypeFromLabel(d.type) || "produce";
    acc[produce] = (acc[produce] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(produceCounts).map(([produce, count], idx) => ({
    id: idx + 1,
    title: produce.charAt(0).toUpperCase() + produce.slice(1),
    severity: "high",
    count,
    message:
      produce === "produce"
        ? `AI detected spoilage in ${count} item${count > 1 ? "s" : ""}. Please inspect latest camera images and remove affected items physically from the storage unit.`
        : `AI detected overripening in ${count} ${produce}. Please inspect latest camera images and remove affected items physically from the storage unit.`,
    source: "camera",
    timestamp: new Date().toISOString(),
  }));
}

function buildCameraInventorySummaryFromDetections(detections = []) {
  const counts = detections.reduce(
    (acc, d) => {
      const produceType = getProduceTypeFromLabel(d.type);
      const isApple = produceType === "apples";
      const isPotato = produceType === "potatoes";
      const isSpoiled = isBadQualityLabel(d.type);

      if (isApple) {
        acc.totalApples += 1;
        if (isSpoiled) acc.applesBad += 1;
      }
      if (isPotato) {
        acc.totalPotatoes += 1;
        if (isSpoiled) acc.potatoesBad += 1;
      }

      return acc;
    },
    { totalApples: 0, totalPotatoes: 0, applesBad: 0, potatoesBad: 0 },
  );

  return {
    totalApples: counts.totalApples,
    totalPotatoes: counts.totalPotatoes,
    applesBad: counts.applesBad,
    applesGood: Math.max(0, counts.totalApples - counts.applesBad),
    potatoesBad: counts.potatoesBad,
    potatoesGood: Math.max(0, counts.totalPotatoes - counts.potatoesBad),
    analyzedAt: new Date().toISOString(),
  };
}

function getLatestSnapshotDetections() {
  try {
    const latest = fs
      .readdirSync(snapshotsDir)
      .filter((file) => file.endsWith(".jpg"))
      .map((file) => ({
        name: file,
        timestamp: fs.statSync(path.join(snapshotsDir, file)).mtime.getTime(),
      }))
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (!latest) {
      return { detections: [], snapshotName: null, timestamp: null };
    }

    const meta = loadSnapshotsMeta();
    const snapshotMeta =
      meta && typeof meta[latest.name] === "object" ? meta[latest.name] : null;
    const detections = Array.isArray(snapshotMeta?.detections)
      ? snapshotMeta.detections
      : [];

    return {
      detections,
      snapshotName: latest.name,
      timestamp: latest.timestamp,
    };
  } catch (error) {
    console.error(
      "⚠️  Failed to resolve latest snapshot detections:",
      error.message,
    );
    return { detections: [], snapshotName: null, timestamp: null };
  }
}

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

app.get("/api/history", (req, res) => {
  const { range } = req.query;
  const { resolved, rows } = getFilteredHistory(range);
  const hasRangeData = rows.length > 0;
  const effectiveRows = hasRangeData ? rows : getAllHistoryRows();
  const sampled = downsampleRows(effectiveRows, 240);

  res.json({
    success: true,
    range: resolved.key,
    hasRangeData,
    fallbackUsed: !hasRangeData,
    totalReadings: effectiveRows.length,
    points: sampled.map((row) => ({
      timestamp: row.timestamp,
      temperature: row.temperature,
      humidity: row.humidity,
      ethylene: row.voc / 1000.0,
      voc: row.voc,
    })),
  });
});

app.get("/api/exports/logs.csv", (req, res) => {
  const { range } = req.query;
  const { resolved, rows } = getFilteredHistory(range);
  const thresholds = currentProduce.thresholds;

  const headers = [
    "timestamp",
    "temperature_c",
    "temperature_status",
    "humidity_percent",
    "humidity_status",
    "voc_ppm",
    "voc_status",
  ];

  const csvRows = rows.map((row) => [
    new Date(row.timestamp).toISOString(),
    row.temperature.toFixed(2),
    getMetricStatus("temperature", row.temperature, thresholds),
    row.humidity.toFixed(2),
    getMetricStatus("humidity", row.humidity, thresholds),
    row.voc.toFixed(2),
    getMetricStatus("voc", row.voc, thresholds),
  ]);

  const content = [headers, ...csvRows]
    .map((line) => line.map(csvEscape).join(","))
    .join("\n");

  const fileName = `cold-storage-logs-${resolved.key}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(content);
});

app.get("/api/exports/trends.csv", (req, res) => {
  const { range } = req.query;
  const { resolved, rows } = getFilteredHistory(range);

  const temps = rows.map((r) => r.temperature);
  const humidities = rows.map((r) => r.humidity);
  const vocs = rows.map((r) => r.voc);

  const tempStats = metricStats(temps);
  const humidityStats = metricStats(humidities);
  const vocStats = metricStats(vocs);

  const summaryRows = [
    [
      "temperature",
      tempStats.current.toFixed(2),
      tempStats.min.toFixed(2),
      tempStats.max.toFixed(2),
      tempStats.avg.toFixed(2),
      tempStats.trend,
      currentProduce.thresholds.temperature.min,
      currentProduce.thresholds.temperature.max,
      "",
    ],
    [
      "humidity",
      humidityStats.current.toFixed(2),
      humidityStats.min.toFixed(2),
      humidityStats.max.toFixed(2),
      humidityStats.avg.toFixed(2),
      humidityStats.trend,
      currentProduce.thresholds.humidity.min,
      currentProduce.thresholds.humidity.max,
      "",
    ],
    [
      "voc",
      vocStats.current.toFixed(2),
      vocStats.min.toFixed(2),
      vocStats.max.toFixed(2),
      vocStats.avg.toFixed(2),
      vocStats.trend,
      "",
      "",
      currentProduce.thresholds.voc,
    ],
  ];

  const headers = [
    "metric",
    "current",
    "min",
    "max",
    "average",
    "trend",
    "threshold_min",
    "threshold_max",
    "threshold_limit",
  ];

  const content = [headers, ...summaryRows]
    .map((line) => line.map(csvEscape).join(","))
    .join("\n");

  const fileName = `cold-storage-trends-${resolved.key}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(content);
});

app.get("/api/exports/summary.pdf", (req, res) => {
  const { range } = req.query;
  const { resolved, rows } = getFilteredHistory(range);
  const thresholds = currentProduce.thresholds;

  const temps = rows.map((r) => r.temperature);
  const humidities = rows.map((r) => r.humidity);
  const vocs = rows.map((r) => r.voc);

  const tempStats = metricStats(temps);
  const humidityStats = metricStats(humidities);
  const vocStats = metricStats(vocs);

  const anomalies = [];
  if (tempStats.max > thresholds.temperature.max) {
    anomalies.push(
      `Temperature peaked at ${tempStats.max.toFixed(1)}°C (max ${thresholds.temperature.max}°C).`,
    );
  }
  if (tempStats.min < thresholds.temperature.min) {
    anomalies.push(
      `Temperature dropped to ${tempStats.min.toFixed(1)}°C (min ${thresholds.temperature.min}°C).`,
    );
  }
  if (humidityStats.min < thresholds.humidity.min) {
    anomalies.push(
      `Humidity dropped to ${humidityStats.min.toFixed(1)}% (min ${thresholds.humidity.min}%).`,
    );
  }
  if (humidityStats.max > thresholds.humidity.max) {
    anomalies.push(
      `Humidity reached ${humidityStats.max.toFixed(1)}% (max ${thresholds.humidity.max}%).`,
    );
  }
  if (vocStats.max > thresholds.voc) {
    anomalies.push(
      `VOC reached ${vocStats.max.toFixed(0)} ppm (limit ${thresholds.voc} ppm).`,
    );
  }

  const fileName = `cold-storage-combined-report-${resolved.key}-${new Date().toISOString().slice(0, 10)}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).text("Cold Storage Combined Monitoring Report", {
    align: "left",
  });
  doc.moveDown(0.4);
  doc
    .fontSize(11)
    .fillColor("#4b5563")
    .text(`Generated: ${new Date().toLocaleString()}`)
    .text(`Range: ${resolved.key.toUpperCase()} | Readings: ${rows.length}`)
    .text(
      `Produce profile: ${currentProduce.type ? currentProduce.type : "not detected"}`,
    );

  doc.moveDown();
  doc.fillColor("#111827").fontSize(13).text("Key Metrics");
  doc.moveDown(0.3);
  doc
    .fontSize(11)
    .text(
      `Temperature: current ${tempStats.current.toFixed(1)}°C | min ${tempStats.min.toFixed(1)} | avg ${tempStats.avg.toFixed(1)} | max ${tempStats.max.toFixed(1)} | trend ${tempStats.trend}`,
    );
  doc.text(
    `Humidity: current ${humidityStats.current.toFixed(1)}% | min ${humidityStats.min.toFixed(1)} | avg ${humidityStats.avg.toFixed(1)} | max ${humidityStats.max.toFixed(1)} | trend ${humidityStats.trend}`,
  );
  doc.text(
    `VOC: current ${vocStats.current.toFixed(0)} ppm | min ${vocStats.min.toFixed(0)} | avg ${vocStats.avg.toFixed(0)} | max ${vocStats.max.toFixed(0)} | trend ${vocStats.trend}`,
  );

  doc.moveDown();
  doc.fillColor("#111827").fontSize(13).text("Trend Overview");
  doc.moveDown(0.3);
  doc
    .fontSize(11)
    .text(
      `Temperature trend: ${tempStats.trend} | Humidity trend: ${humidityStats.trend} | VOC trend: ${vocStats.trend}`,
    );

  doc.moveDown();
  doc.fillColor("#111827").fontSize(13).text("Configured Thresholds");
  doc.moveDown(0.3);
  doc
    .fontSize(11)
    .text(
      `Temperature: ${thresholds.temperature.min}°C to ${thresholds.temperature.max}°C`,
    )
    .text(
      `Humidity: ${thresholds.humidity.min}% to ${thresholds.humidity.max}%`,
    )
    .text(`VOC limit: ${thresholds.voc} ppm`);

  doc.moveDown();
  doc.fillColor("#111827").fontSize(13).text("Alert Summary");
  doc.moveDown(0.3);
  doc.fontSize(11);
  if (!anomalies.length) {
    doc
      .fillColor("#047857")
      .text("All monitored values stayed within safe ranges.");
  } else {
    doc.fillColor("#991b1b");
    anomalies.forEach((line) => doc.text(`- ${line}`));
  }

  doc.moveDown();
  doc.fillColor("#111827").fontSize(13).text("Data Log (Most Recent Readings)");
  doc.moveDown(0.3);

  const recentRows = rows.slice(-80).reverse();
  if (!recentRows.length) {
    doc
      .fontSize(11)
      .fillColor("#6b7280")
      .text("No readings available for this range.");
  } else {
    doc
      .fontSize(10)
      .fillColor("#111827")
      .text("Timestamp | Temp (C) | Humidity (%) | VOC (ppm) | Status", {
        underline: true,
      });

    recentRows.forEach((row) => {
      if (doc.y > 740) {
        doc.addPage();
      }

      const tempStatus = getMetricStatus(
        "temperature",
        row.temperature,
        thresholds,
      );
      const humidityStatus = getMetricStatus(
        "humidity",
        row.humidity,
        thresholds,
      );
      const vocStatus = getMetricStatus("voc", row.voc, thresholds);
      const finalStatus =
        tempStatus === "safe" &&
        humidityStatus === "safe" &&
        vocStatus === "safe"
          ? "safe"
          : "attention";

      const line = `${new Date(row.timestamp).toLocaleString()} | ${row.temperature.toFixed(1)} | ${row.humidity.toFixed(1)} | ${row.voc.toFixed(0)} | ${finalStatus}`;
      doc
        .fontSize(9)
        .fillColor(finalStatus === "safe" ? "#065f46" : "#991b1b")
        .text(line);
    });
  }

  doc.end();
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
    const limit = Number(req.query.limit || 0);
    const snapshotsMeta = loadSnapshotsMeta();
    const files = fs
      .readdirSync(snapshotsDir)
      .filter((file) => file.endsWith(".jpg"))
      .map((file) => ({
        name: file,
        url: `/snapshots/${file}`,
        timestamp: fs.statSync(path.join(snapshotsDir, file)).mtime.getTime(),
        ...((snapshotsMeta[file] && typeof snapshotsMeta[file] === "object"
          ? snapshotsMeta[file]
          : {}) || {}),
      }))
      .sort((a, b) => b.timestamp - a.timestamp);

    const snapshots =
      Number.isFinite(limit) && limit > 0 ? files.slice(0, limit) : files;

    res.json({
      success: true,
      snapshots,
    });
  } catch (error) {
    console.error("❌ Error getting snapshots:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint for dashboard AI quality alerts
app.get("/api/ai-alerts", (req, res) => {
  const { detections, snapshotName, timestamp } = getLatestSnapshotDetections();
  const alertsFromLatest = buildAIQualityAlertsFromDetections(detections);
  const activeCount = alertsFromLatest.filter(
    (a) => a.severity === "high" || a.severity === "medium",
  ).length;

  res.json({
    success: true,
    alerts: alertsFromLatest,
    activeCount,
    cleared: alertsFromLatest.length === 0,
    sourceSnapshot: snapshotName,
    sourceTimestamp: timestamp,
  });
});

app.get("/api/camera-inventory-summary", (req, res) => {
  const { detections, snapshotName, timestamp } = getLatestSnapshotDetections();
  const summaryFromLatest =
    buildCameraInventorySummaryFromDetections(detections);
  res.json({
    success: true,
    summary: summaryFromLatest,
    sourceSnapshot: snapshotName,
    sourceTimestamp: timestamp,
  });
});

app.get("/api/inference-health", (req, res) => {
  const provider = INFERENCE_PROVIDER;
  const isRoboflow = provider === "roboflow";
  const roboflowConfig = {
    apiKeySet: Boolean(ROBOFLOW_API_KEY),
    projectSet: Boolean(ROBOFLOW_PROJECT),
    versionSet: Boolean(ROBOFLOW_VERSION),
    confidence: ROBOFLOW_CONFIDENCE,
    overlap: ROBOFLOW_OVERLAP,
    apiBase: ROBOFLOW_API_BASE,
  };

  const localConfig = {
    url: LOCAL_INFERENCE_URL,
  };

  const ready = isRoboflow
    ? roboflowConfig.apiKeySet &&
      roboflowConfig.projectSet &&
      roboflowConfig.versionSet
    : Boolean(LOCAL_INFERENCE_URL);

  res.json({
    success: true,
    provider,
    ready,
    roboflow: roboflowConfig,
    local: localConfig,
    timestamp: new Date().toISOString(),
  });
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

    // Normalize upload to 640x640 (high quality) and save to snapshots folder
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const savedImagePath = path.join(snapshotsDir, `snapshot_${timestamp}.jpg`);
    await sharp(req.file.path)
      .resize(NORMALIZED_IMAGE_SIZE, NORMALIZED_IMAGE_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0 },
      })
      .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: "4:4:4" })
      .toFile(savedImagePath);
    console.log(
      `💾 Image saved to: ${savedImagePath} (${NORMALIZED_IMAGE_SIZE}x${NORMALIZED_IMAGE_SIZE})`,
    );

    // Run inference using configured provider (local or roboflow)
    try {
      const inference = await runInference(savedImagePath);
      const { detected, confidence, all_detections, provider } = inference;
      const normalizedDetectedProduce = getProduceTypeFromLabel(detected);
      await annotateSnapshotImage(
        savedImagePath,
        all_detections || [],
        NORMALIZED_IMAGE_SIZE,
        NORMALIZED_IMAGE_SIZE,
      );
      const snapshotName = path.basename(savedImagePath);
      const snapshotsMeta = loadSnapshotsMeta();
      snapshotsMeta[snapshotName] = {
        provider: provider || INFERENCE_PROVIDER,
        detected: normalizedDetectedProduce,
        rawDetectedLabel: detected,
        confidence: Number(confidence || 0),
        detections: Array.isArray(all_detections)
          ? all_detections.map((d) => ({
              type: normalizeDetectionLabel(d.type),
              confidence: Number(d.confidence || 0),
              bbox: Array.isArray(d.bbox)
                ? d.bbox.map((v) => Number(v || 0))
                : [0, 0, 0, 0],
            }))
          : [],
        imageSize: {
          width: NORMALIZED_IMAGE_SIZE,
          height: NORMALIZED_IMAGE_SIZE,
        },
        annotated: true,
        capturedAt: new Date().toISOString(),
      };
      saveSnapshotsMeta(snapshotsMeta);

      // Build informational AI quality alerts from latest detections.
      // If no spoilage classes are present, alerts are cleared automatically.
      latestAIQualityAlerts = buildAIQualityAlertsFromDetections(
        all_detections || [],
      );
      latestCameraInventorySummary = buildCameraInventorySummaryFromDetections(
        all_detections || [],
      );

      console.log(
        `🤖 ${String(provider || "inference").toUpperCase()} detected: ${
          detected || "nothing"
        } -> ${
          normalizedDetectedProduce || "unmapped"
        } (confidence: ${(confidence * 100).toFixed(1)}%)`,
      );

      // Only update if produce was detected with good confidence and no manual override
      if (
        normalizedDetectedProduce &&
        confidence > 0.5 &&
        !currentProduce.manualOverride
      ) {
        const settings = getProduceSettings(normalizedDetectedProduce);
        if (settings) {
          currentProduce = {
            type: normalizedDetectedProduce,
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
            `📊 Auto-adjusted thresholds for ${normalizedDetectedProduce}:`,
            currentProduce.thresholds,
          );
        }
      }

      res.json({
        success: true,
        provider: provider || INFERENCE_PROVIDER,
        detected: normalizedDetectedProduce,
        rawDetectedLabel: detected,
        confidence: confidence,
        aiAlerts: latestAIQualityAlerts,
        inventorySummary: latestCameraInventorySummary,
        produce: currentProduce,
      });
    } catch (inferenceError) {
      console.error("⚠️  Inference error:", inferenceError.message);
      const snapshotName = path.basename(savedImagePath);
      const snapshotsMeta = loadSnapshotsMeta();
      snapshotsMeta[snapshotName] = {
        provider: INFERENCE_PROVIDER,
        detected: null,
        rawDetectedLabel: null,
        confidence: 0,
        detections: [],
        imageSize: {
          width: NORMALIZED_IMAGE_SIZE,
          height: NORMALIZED_IMAGE_SIZE,
        },
        capturedAt: new Date().toISOString(),
        error: String(inferenceError.message || "inference error"),
      };
      saveSnapshotsMeta(snapshotsMeta);

      // Fallback: continue without detection
      res.json({
        success: true,
        provider: INFERENCE_PROVIDER,
        detected: null,
        error: `Inference service unavailable (${INFERENCE_PROVIDER})`,
        details: inferenceError.message,
        aiAlerts: latestAIQualityAlerts,
        inventorySummary: latestCameraInventorySummary,
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
  console.log(`🧠 Inference Provider: ${INFERENCE_PROVIDER}`);

  if (INFERENCE_PROVIDER === "roboflow") {
    const roboflowReady =
      Boolean(ROBOFLOW_API_KEY) &&
      Boolean(ROBOFLOW_PROJECT) &&
      Boolean(ROBOFLOW_VERSION);
    if (roboflowReady) {
      console.log(
        `☁️  Roboflow configured: ${ROBOFLOW_PROJECT}/${ROBOFLOW_VERSION}`,
      );
    } else {
      console.warn(
        "⚠️  Roboflow mode selected but env vars are incomplete. Set ROBOFLOW_API_KEY, ROBOFLOW_PROJECT, and ROBOFLOW_VERSION.",
      );
    }
  } else {
    console.log(`🖥️  Local inference URL: ${LOCAL_INFERENCE_URL}`);
  }

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
