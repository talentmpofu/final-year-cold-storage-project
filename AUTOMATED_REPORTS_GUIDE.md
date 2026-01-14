# 📧 Automated Reports - User Guide

## What's New?

Your cold storage system now automatically generates and emails detailed reports!

**✨ NEW: Data Persistence!**
- Historical data is saved to `metrics_history.json`
- Data persists even after server restarts
- No data loss when you turn off your laptop

## ✨ Features

### Automated Scheduling
- **Daily Report**: Sent every day at 8:00 AM
- **Weekly Report**: Sent every Monday at 9:00 AM
- Reports are automatically emailed to your configured email address

### Data Persistence
- **Automatic saving**: Data saved to file every 10 sensor readings
- **Loads on startup**: Historical data restored when server starts
- **Graceful shutdown**: Data saved when you stop the server (Ctrl+C)
- **File location**: `web/metrics_history.json`
- **Storage**: Last 1000 sensor readings

### Report Contents

Each report includes:
- **📊 Environmental Metrics Summary**
  - Temperature (min/avg/max)
  - Humidity (min/avg/max)
  - VOC levels (min/avg/max)
  - Number of sensor readings analyzed

- **🎯 Current Produce Status**
  - Detected produce type (apples/potatoes)
  - Detection confidence
  - Detection timestamp

- **⚠️ Alerts & Anomalies**
  - Temperature violations
  - Humidity issues
  - High VOC detections
  - Or "All clear" if no issues

- **📈 Threshold Compliance**
  - Comparison of actual vs target ranges
  - Status indicators for each parameter

- **💡 Recommendations**
  - Actionable suggestions based on detected issues
  - Maintenance reminders

## 📅 Report Schedule

| Report Type | Frequency | Time | Period Covered |
|------------|-----------|------|----------------|
| **Daily** | Every day | 8:00 AM | Last 24 hours |
| **Weekly** | Monday | 9:00 AM | Last 7 days |

## 🧪 Manual Testing

### Test Report Now

You can manually trigger a report using curl or Postman:

**Daily Report:**
```bash
curl -X POST http://localhost:3000/api/reports/send \
  -H "Content-Type: application/json" \
  -d '{"type":"daily"}'
```

**Weekly Report:**
```bash
curl -X POST http://localhost:3000/api/reports/send \
  -H "Content-Type: application/json" \
  -d '{"type":"weekly"}'
```

**Send to Different Email:**
```bash
curl -X POST http://localhost:3000/api/reports/send \
  -H "Content-Type: application/json" \
  -d '{"type":"daily","email":"someone@example.com"}'
```

### Using PowerShell (Windows):
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/reports/send" `
  -Method Post `
  -Body '{"type":"daily"}' `
  -ContentType "application/json"
```

## ⚙️ Configuration

### Change Report Schedule

Edit `web/server.js` around line 500:

```javascript
// Daily report - Change time here (cron format)
cron.schedule("0 8 * * *", async () => { // "0 8 * * *" = 8:00 AM
  console.log("📧 Sending daily automated report...");
  await sendReport("daily", currentProduce, recipientEmail);
});

// Weekly report - Change day/time here
cron.schedule("0 9 * * 1", async () => { // "0 9 * * 1" = Monday 9:00 AM
  console.log("📧 Sending weekly automated report...");
  await sendReport("weekly", currentProduce, recipientEmail);
});
```

### Cron Format Reference

```
 ┌────────────── second (optional, 0-59)
 │ ┌──────────── minute (0-59)
 │ │ ┌────────── hour (0-23)
 │ │ │ ┌──────── day of month (1-31)
 │ │ │ │ ┌────── month (1-12)
 │ │ │ │ │ ┌──── day of week (0-7, 0 & 7 = Sunday)
 │ │ │ │ │ │
 * * * * * *
```

**Examples:**
- `0 8 * * *` = 8:00 AM every day
- `0 17 * * *` = 5:00 PM every day
- `0 9 * * 1` = 9:00 AM every Monday
- `0 0 1 * *` = Midnight on 1st of every month
- `0 */6 * * *` = Every 6 hours

### Change Recipient Email

Edit `web/server.js` line 498:

```javascript
const recipientEmail = "youremail@example.com"; // Change this
```

Or keep it as `emailConfig.user` to use your configured email.

## 📧 Email Configuration

Reports use the same email settings as alerts. Ensure you've configured:

**web/emailConfig.js:**
```javascript
module.exports = {
  service: "gmail",
  user: "your-email@gmail.com",
  password: "your-app-password",
  // ... rest of config
};
```

See [EMAIL_SETUP_GUIDE.md](EMAIL_SETUP_GUIDE.md) for full email configuration.

## 🎨 Report Styling

Reports are sent as HTML emails with:
- Professional gradient header
- Color-coded sections
- Responsive design
- Tables for threshold comparison
- Alert highlighting (red for warnings, green for all-clear)

## 📊 What if There's No Data?

- Reports require at least 1 sensor reading in the time period
- If no data: "No data available" message returned
- System stores last 1000 sensor readings for report generation

## 🔍 Troubleshooting

### Reports Not Sending

1. **Check server is running:**
   ```bash
   # Should see "⏰ Automated reports scheduled" in console
   ```

2. **Verify email config:**
   ```bash
   curl http://localhost:3000/api/email/test
   ```

3. **Check console logs:**
   - Look for `📧 Sending daily automated report...`
   - Check for email sending errors

### Test Email Not Received

1. Check spam/junk folder
2. Verify email address is correct
3. Check Gmail app password is valid
4. Try manual report trigger first

### Report Shows "No Data"

1. Ensure ESP32 is sending sensor data
2. Check server console for "📥 Received data from ESP32"
3. Verify metrics are being stored (check logs)
4. Try again after ESP32 sends data

## 📁 Files Added

- **web/reportGenerator.js** - Report generation logic
- **AUTOMATED_REPORTS_GUIDE.md** - This guide

## 🎯 Benefits

1. **Automated Monitoring**: No need to check dashboard constantly
2. **Historical Analysis**: See trends over 24 hours or 7 days
3. **Anomaly Detection**: Get alerted to issues automatically
4. **Documentation**: Perfect for project report/thesis
5. **Professional**: Production-ready feature for final year project

## 🚀 Next Steps

1. ✅ Reports are already configured and running!
2. Test manually with curl command above
3. Wait for 8:00 AM tomorrow for first auto-report
4. Check your email (and spam folder)
5. Adjust schedule if needed

## 💡 Tips

- Reports accumulate data over time - more data = better insights
- Weekly reports show broader trends than daily
- Keep reports for documentation/thesis
- Screenshots of email reports look great in presentations!

---

**Status**: ✅ Active (Auto-sending enabled)  
**Daily Report**: 8:00 AM every day  
**Weekly Report**: 9:00 AM every Monday  
**Last Updated**: January 14, 2026
