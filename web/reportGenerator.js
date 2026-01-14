// Automated Report Generator for Cold Storage Unit
// Generates daily/weekly HTML email reports

const nodemailer = require("nodemailer");
const emailConfig = require("./emailConfig");
const fs = require("fs");
const path = require("path");

// Store metrics history for report generation
let metricsHistory = [];
const MAX_HISTORY = 1000; // Store last 1000 readings
const HISTORY_FILE = path.join(__dirname, "metrics_history.json");

// Load metrics history from file on startup
function loadHistoryFromFile() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, "utf8");
      metricsHistory = JSON.parse(data);
      console.log(
        `📂 Loaded ${metricsHistory.length} historical metrics from file`
      );
    } else {
      console.log("📂 No history file found, starting fresh");
    }
  } catch (error) {
    console.error("❌ Error loading metrics history:", error.message);
    metricsHistory = [];
  }
}

// Save metrics history to file
function saveHistoryToFile() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(metricsHistory, null, 2));
    console.log(`💾 Saved ${metricsHistory.length} metrics to file`);
  } catch (error) {
    console.error("❌ Error saving metrics history:", error.message);
  }
}

// Add a metric reading to history
function addMetricToHistory(metric) {
  metricsHistory.push({
    timestamp: new Date(),
    temperature: metric.temperature?.value || 0,
    humidity: metric.humidity?.value || 0,
    voc: metric.vocs?.value || 0,
  });

  // Keep only last MAX_HISTORY entries
  if (metricsHistory.length > MAX_HISTORY) {
    metricsHistory.shift();
  }

  // Save to file every 10 readings (not every time for performance)
  if (metricsHistory.length % 10 === 0) {
    saveHistoryToFile();
  }
}

// Calculate statistics from metrics history
function calculateStats(data, hours = 24) {
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  const recentData = data.filter((m) => new Date(m.timestamp) > cutoffTime);

  if (recentData.length === 0) {
    return { min: 0, max: 0, avg: 0, count: 0 };
  }

  return {
    min: Math.min(...recentData.map((m) => m)),
    max: Math.max(...recentData.map((m) => m)),
    avg: recentData.reduce((a, b) => a + b, 0) / recentData.length,
    count: recentData.length,
  };
}

// Generate HTML report
function generateHTMLReport(type = "daily", currentProduce) {
  const hours = type === "daily" ? 24 : 168; // 24h or 7 days
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  const recentMetrics = metricsHistory.filter(
    (m) => new Date(m.timestamp) > cutoffTime
  );

  if (recentMetrics.length === 0) {
    return null; // No data to report
  }

  // Extract data arrays
  const temps = recentMetrics.map((m) => m.temperature);
  const humidities = recentMetrics.map((m) => m.humidity);
  const vocs = recentMetrics.map((m) => m.voc);

  // Calculate statistics
  const tempStats = {
    min: Math.min(...temps).toFixed(1),
    max: Math.max(...temps).toFixed(1),
    avg: (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1),
  };

  const humidityStats = {
    min: Math.min(...humidities).toFixed(1),
    max: Math.max(...humidities).toFixed(1),
    avg: (humidities.reduce((a, b) => a + b, 0) / humidities.length).toFixed(1),
  };

  const vocStats = {
    min: Math.min(...vocs).toFixed(0),
    max: Math.max(...vocs).toFixed(0),
    avg: (vocs.reduce((a, b) => a + b, 0) / vocs.length).toFixed(0),
  };

  // Detect anomalies
  const anomalies = [];
  const thresholds = currentProduce.thresholds;

  if (parseFloat(tempStats.max) > thresholds.temperature.max) {
    anomalies.push(
      `🔥 High temperature detected: ${tempStats.max}°C (threshold: ${thresholds.temperature.max}°C)`
    );
  }
  if (parseFloat(tempStats.min) < thresholds.temperature.min) {
    anomalies.push(
      `❄️ Low temperature detected: ${tempStats.min}°C (threshold: ${thresholds.temperature.min}°C)`
    );
  }
  if (parseFloat(humidityStats.min) < thresholds.humidity.min) {
    anomalies.push(
      `💧 Low humidity detected: ${humidityStats.min}% (threshold: ${thresholds.humidity.min}%)`
    );
  }
  if (parseFloat(vocStats.max) > thresholds.voc) {
    anomalies.push(
      `⚠️ High VOC levels detected: ${vocStats.max} (threshold: ${thresholds.voc})`
    );
  }

  const reportPeriod = type === "daily" ? "Last 24 Hours" : "Last 7 Days";
  const now = new Date().toLocaleString();

  // Generate HTML
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 10px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px;
      margin: -30px -30px 30px -30px;
    }
    h1 {
      margin: 0 0 10px 0;
      font-size: 28px;
    }
    .subtitle {
      margin: 0;
      opacity: 0.9;
      font-size: 14px;
    }
    .section {
      margin: 30px 0;
    }
    .section h2 {
      color: #667eea;
      border-bottom: 2px solid #667eea;
      padding-bottom: 10px;
      font-size: 20px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin: 20px 0;
    }
    .stat-card {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #1f2937;
    }
    .stat-range {
      font-size: 12px;
      color: #6b7280;
      margin-top: 8px;
    }
    .metric-row {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      margin: 10px 0;
    }
    .metric-name {
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    }
    .metric-values {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
    }
    .metric-value {
      flex: 1;
      text-align: center;
    }
    .metric-value span {
      display: block;
      color: #6b7280;
      font-size: 11px;
      text-transform: uppercase;
    }
    .metric-value strong {
      display: block;
      color: #1f2937;
      font-size: 18px;
      margin-top: 4px;
    }
    .anomaly {
      background: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 12px 16px;
      margin: 8px 0;
      border-radius: 4px;
      color: #991b1b;
    }
    .no-anomaly {
      background: #f0fdf4;
      border-left: 4px solid #10b981;
      padding: 12px 16px;
      margin: 8px 0;
      border-radius: 4px;
      color: #065f46;
    }
    .produce-info {
      background: #eff6ff;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #3b82f6;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 12px;
      color: #6b7280;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    th {
      background: #f9fafb;
      font-weight: 600;
      color: #374151;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>❄️ Cold Storage Unit Report</h1>
      <p class="subtitle">${reportPeriod} | Generated: ${now}</p>
    </div>

    <div class="section">
      <h2>📊 Current Produce Status</h2>
      <div class="produce-info">
        <strong style="font-size: 18px; color: #1f2937;">
          ${
            currentProduce.type
              ? currentProduce.type.charAt(0).toUpperCase() +
                currentProduce.type.slice(1)
              : "No produce detected"
          }
        </strong>
        ${
          currentProduce.detectedAt
            ? `<p style="margin: 8px 0 0 0; color: #6b7280;">Detected: ${new Date(
                currentProduce.detectedAt
              ).toLocaleString()}</p>`
            : ""
        }
        ${
          currentProduce.confidence
            ? `<p style="margin: 4px 0 0 0; color: #6b7280;">Confidence: ${(
                currentProduce.confidence * 100
              ).toFixed(1)}%</p>`
            : ""
        }
      </div>
    </div>

    <div class="section">
      <h2>📈 Environmental Metrics Summary</h2>
      <p style="color: #6b7280;">Based on ${
        recentMetrics.length
      } sensor readings over ${reportPeriod.toLowerCase()}</p>
      
      <div class="metric-row">
        <div class="metric-name">🌡️ Temperature</div>
        <div class="metric-values">
          <div class="metric-value">
            <span>Minimum</span>
            <strong>${tempStats.min}°C</strong>
          </div>
          <div class="metric-value">
            <span>Average</span>
            <strong>${tempStats.avg}°C</strong>
          </div>
          <div class="metric-value">
            <span>Maximum</span>
            <strong>${tempStats.max}°C</strong>
          </div>
        </div>
      </div>

      <div class="metric-row">
        <div class="metric-name">💧 Humidity</div>
        <div class="metric-values">
          <div class="metric-value">
            <span>Minimum</span>
            <strong>${humidityStats.min}%</strong>
          </div>
          <div class="metric-value">
            <span>Average</span>
            <strong>${humidityStats.avg}%</strong>
          </div>
          <div class="metric-value">
            <span>Maximum</span>
            <strong>${humidityStats.max}%</strong>
          </div>
        </div>
      </div>

      <div class="metric-row">
        <div class="metric-name">🌫️ VOC/Ethylene Levels</div>
        <div class="metric-values">
          <div class="metric-value">
            <span>Minimum</span>
            <strong>${vocStats.min}</strong>
          </div>
          <div class="metric-value">
            <span>Average</span>
            <strong>${vocStats.avg}</strong>
          </div>
          <div class="metric-value">
            <span>Maximum</span>
            <strong>${vocStats.max}</strong>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>⚠️ Alerts & Anomalies</h2>
      ${
        anomalies.length > 0
          ? anomalies.map((a) => `<div class="anomaly">${a}</div>`).join("")
          : '<div class="no-anomaly">✅ No anomalies detected. All parameters within normal range.</div>'
      }
    </div>

    <div class="section">
      <h2>🎯 Optimal Thresholds</h2>
      <table>
        <tr>
          <th>Parameter</th>
          <th>Current Range</th>
          <th>Target Range</th>
          <th>Status</th>
        </tr>
        <tr>
          <td>Temperature</td>
          <td>${tempStats.min}°C - ${tempStats.max}°C</td>
          <td>${thresholds.temperature.min}°C - ${
    thresholds.temperature.max
  }°C</td>
          <td>${
            parseFloat(tempStats.avg) >= thresholds.temperature.min &&
            parseFloat(tempStats.avg) <= thresholds.temperature.max
              ? "✅ Good"
              : "⚠️ Check"
          }</td>
        </tr>
        <tr>
          <td>Humidity</td>
          <td>${humidityStats.min}% - ${humidityStats.max}%</td>
          <td>${thresholds.humidity.min}% - ${thresholds.humidity.max}%</td>
          <td>${
            parseFloat(humidityStats.avg) >= thresholds.humidity.min &&
            parseFloat(humidityStats.avg) <= thresholds.humidity.max
              ? "✅ Good"
              : "⚠️ Check"
          }</td>
        </tr>
        <tr>
          <td>VOC/Ethylene</td>
          <td>Max: ${vocStats.max}</td>
          <td>< ${thresholds.voc}</td>
          <td>${
            parseFloat(vocStats.max) < thresholds.voc ? "✅ Good" : "⚠️ High"
          }</td>
        </tr>
      </table>
    </div>

    <div class="section">
      <h2>💡 Recommendations</h2>
      <ul style="line-height: 1.8;">
        ${
          anomalies.length === 0
            ? "<li>✅ System is operating within optimal parameters</li>"
            : ""
        }
        ${
          parseFloat(tempStats.avg) > thresholds.temperature.max
            ? "<li>🔧 Consider adjusting cooling system settings</li>"
            : ""
        }
        ${
          parseFloat(humidityStats.avg) < thresholds.humidity.min
            ? "<li>💧 Increase humidity levels or check humidifier</li>"
            : ""
        }
        ${
          parseFloat(vocStats.max) > thresholds.voc
            ? "<li>🌬️ Activate air scrubber or improve ventilation</li>"
            : ""
        }
        <li>📸 Review camera snapshots for visual produce inspection</li>
        <li>🔍 Check door seals and insulation regularly</li>
      </ul>
    </div>

    <div class="footer">
      <p>This is an automated report from your Cold Storage Monitoring System</p>
      <p>Dashboard: <a href="http://localhost:3000">http://localhost:3000</a></p>
    </div>
  </div>
</body>
</html>
  `;

  return html;
}

// Send report email
async function sendReport(type = "daily", currentProduce, recipientEmail) {
  try {
    const html = generateHTMLReport(type, currentProduce);

    if (!html) {
      console.log("⚠️ No data available for report generation");
      return { success: false, message: "No data available" };
    }

    // Create transporter
    const transporter = nodemailer.createTransporter({
      service: emailConfig.service,
      auth: {
        user: emailConfig.user,
        pass: emailConfig.password,
      },
    });

    const reportType = type === "daily" ? "Daily" : "Weekly";
    const subject = `❄️ Cold Storage ${reportType} Report - ${new Date().toLocaleDateString()}`;

    // Send email
    const info = await transporter.sendMail({
      from: `"Cold Storage System" <${emailConfig.user}>`,
      to: recipientEmail,
      subject: subject,
      html: html,
    });

    console.log(
      `✅ ${reportType} report sent successfully to ${recipientEmail}`
    );
    return {
      success: true,
      message: `${reportType} report sent`,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("❌ Error sending report:", error);
    return { success: false, message: error.message };
  }
}

// Load history on module initialization
loadHistoryFromFile();

module.exports = {
  addMetricToHistory,
  generateHTMLReport,
  sendReport,
  getMetricsHistory: () => metricsHistory,
  clearHistory: () => {
    metricsHistory = [];
    saveHistoryToFile();
  },
  saveHistoryToFile, // Export for manual saves
  loadHistoryFromFile, // Export for reloading
};
