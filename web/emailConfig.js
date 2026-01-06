/**
 * Email notification configuration
 * Configure your email settings in .env file
 */

const nodemailer = require("nodemailer");
require("dotenv").config();

// Load email configuration from environment variables
const emailConfig = {
  service: process.env.EMAIL_SERVICE || "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
};

// Who should receive the alerts (from environment variable)
const alertRecipients = process.env.ALERT_RECIPIENTS
  ? process.env.ALERT_RECIPIENTS.split(",").map((email) => email.trim())
  : [];

// Alert cooldown (in milliseconds) - prevent spam
const ALERT_COOLDOWN =
  (parseInt(process.env.ALERT_COOLDOWN_MINUTES) || 30) * 60 * 1000;

// Track last alert times to prevent spam
const lastAlertTimes = {
  temperature: 0,
  humidity: 0,
  voc: 0,
};

// Create email transporter
const transporter = nodemailer.createTransport(emailConfig);

/**
 * Send alert email
 * @param {string} alertType - Type of alert (temperature, humidity, voc)
 * @param {object} data - Alert data
 */
async function sendAlert(alertType, data) {
  // Check cooldown
  const now = Date.now();
  if (now - lastAlertTimes[alertType] < ALERT_COOLDOWN) {
    console.log(`⏳ Alert cooldown active for ${alertType}, skipping email`);
    return;
  }

  const subject = `🚨 Cold Storage Alert: ${alertType.toUpperCase()} Threshold Exceeded`;

  let message = `
    <h2>Cold Storage Alert</h2>
    <p><strong>Alert Type:</strong> ${alertType.toUpperCase()}</p>
    <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
    <hr>
  `;

  if (alertType === "temperature") {
    message += `
      <p><strong>Current Temperature:</strong> ${data.current}°C</p>
      <p><strong>Safe Range:</strong> ${data.min}°C - ${data.max}°C</p>
      <p><strong>Produce Type:</strong> ${data.produceType || "Not set"}</p>
      <p style="color: red;"><strong>⚠️ Temperature is ${
        data.current > data.max ? "TOO HIGH" : "TOO LOW"
      }</strong></p>
    `;
  } else if (alertType === "humidity") {
    message += `
      <p><strong>Current Humidity:</strong> ${data.current}%</p>
      <p><strong>Safe Range:</strong> ${data.min}% - ${data.max}%</p>
      <p><strong>Produce Type:</strong> ${data.produceType || "Not set"}</p>
      <p style="color: red;"><strong>⚠️ Humidity is ${
        data.current > data.max ? "TOO HIGH" : "TOO LOW"
      }</strong></p>
    `;
  } else if (alertType === "voc") {
    message += `
      <p><strong>Current VOC Level:</strong> ${data.current} units</p>
      <p><strong>Maximum Safe Level:</strong> ${data.max} units</p>
      <p><strong>Produce Type:</strong> ${data.produceType || "Not set"}</p>
      <p style="color: red;"><strong>⚠️ VOC levels indicate produce spoilage</strong></p>
    `;
  }

  message += `
    <hr>
    <p><em>This is an automated alert from your Cold Storage Monitoring System.</em></p>
    <p>Please check your cold storage unit immediately.</p>
  `;

  const mailOptions = {
    from: emailConfig.auth.user,
    to: alertRecipients.join(", "),
    subject: subject,
    html: message,
  };

  try {
    await transporter.sendMail(mailOptions);
    lastAlertTimes[alertType] = now;
    console.log(`✅ Alert email sent for ${alertType}`);
  } catch (error) {
    console.error(`❌ Failed to send alert email:`, error.message);
  }
}

/**
 * Check thresholds and send alerts if needed
 * @param {object} metrics - Current sensor metrics
 * @param {object} thresholds - Current threshold settings
 * @param {string} produceType - Current produce type
 */
function checkAndAlert(metrics, thresholds, produceType) {
  // Check temperature
  if (
    metrics.temperature.value < thresholds.temperature.min ||
    metrics.temperature.value > thresholds.temperature.max
  ) {
    sendAlert("temperature", {
      current: metrics.temperature.value,
      min: thresholds.temperature.min,
      max: thresholds.temperature.max,
      produceType: produceType,
    });
  }

  // Check humidity
  if (
    metrics.humidity.value < thresholds.humidity.min ||
    metrics.humidity.value > thresholds.humidity.max
  ) {
    sendAlert("humidity", {
      current: metrics.humidity.value,
      min: thresholds.humidity.min,
      max: thresholds.humidity.max,
      produceType: produceType,
    });
  }

  // Check VOC
  if (metrics.vocs.value > thresholds.voc) {
    sendAlert("voc", {
      current: metrics.vocs.value,
      max: thresholds.voc,
      produceType: produceType,
    });
  }
}

/**
 * Verify email configuration is working
 * @returns {Promise<boolean>} True if email is configured correctly
 */
async function verifyEmailConfig() {
  if (!emailConfig.auth.user || !emailConfig.auth.pass) {
    console.error("❌ Email credentials not configured in .env file");
    return false;
  }

  if (alertRecipients.length === 0) {
    console.error("❌ No alert recipients configured in .env file");
    return false;
  }

  try {
    await transporter.verify();
    console.log("✅ Email configuration verified successfully");
    console.log(`📧 Sender: ${emailConfig.auth.user}`);
    console.log(`📬 Recipients: ${alertRecipients.join(", ")}`);
    return true;
  } catch (error) {
    console.error("❌ Email configuration error:", error.message);
    console.log(
      "\n📖 Please check EMAIL_SETUP_GUIDE.md for setup instructions"
    );
    return false;
  }
}

/**
 * Send a test email to verify configuration
 */
async function sendTestEmail() {
  const mailOptions = {
    from: emailConfig.auth.user,
    to: alertRecipients.join(", "),
    subject: "🧪 Cold Storage System - Test Email",
    html: `
      <h2>Test Email - Cold Storage Monitoring System</h2>
      <p>This is a test email to verify your email configuration is working correctly.</p>
      <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      <hr>
      <p style="color: green;">✅ If you're reading this, your email notifications are configured correctly!</p>
      <hr>
      <p><em>This is a test message from your Cold Storage Monitoring System.</em></p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("✅ Test email sent successfully");
    return true;
  } catch (error) {
    console.error("❌ Failed to send test email:", error.message);
    return false;
  }
}

module.exports = {
  sendAlert,
  checkAndAlert,
  verifyEmailConfig,
  sendTestEmail,
  emailConfig,
  alertRecipients,
};
