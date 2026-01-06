# Quick Email Testing Guide

## Testing Email Notifications

Once you've configured your `.env` file, use these methods to test email alerts:

### Method 1: Using Browser Console (Dashboard)

1. Open the dashboard at `http://localhost:3000`
2. Press `F12` to open Developer Tools
3. Go to the **Console** tab
4. Run one of these commands:

**Test Email Configuration:**
```javascript
fetch('http://localhost:3000/api/test-email', { method: 'POST' })
  .then(r => r.json())
  .then(d => console.log(d));
```

**Test Temperature Alert:**
```javascript
fetch('http://localhost:3000/api/test-alert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ alertType: 'temperature' })
}).then(r => r.json()).then(d => console.log(d));
```

**Test Humidity Alert:**
```javascript
fetch('http://localhost:3000/api/test-alert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ alertType: 'humidity' })
}).then(r => r.json()).then(d => console.log(d));
```

**Test VOC Alert:**
```javascript
fetch('http://localhost:3000/api/test-alert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ alertType: 'voc' })
}).then(r => r.json()).then(d => console.log(d));
```

### Method 2: Using PowerShell/Command Line

**Test Email Configuration:**
```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/test-email -Method POST
```

**Test Temperature Alert:**
```powershell
$body = @{ alertType = "temperature" } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:3000/api/test-alert -Method POST -Body $body -ContentType "application/json"
```

**Test Humidity Alert:**
```powershell
$body = @{ alertType = "humidity" } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:3000/api/test-alert -Method POST -Body $body -ContentType "application/json"
```

**Test VOC Alert:**
```powershell
$body = @{ alertType = "voc" } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:3000/api/test-alert -Method POST -Body $body -ContentType "application/json"
```

### Method 3: Using curl

**Test Email Configuration:**
```bash
curl -X POST http://localhost:3000/api/test-email
```

**Test Temperature Alert:**
```bash
curl -X POST http://localhost:3000/api/test-alert \
  -H "Content-Type: application/json" \
  -d "{\"alertType\":\"temperature\"}"
```

**Test Humidity Alert:**
```bash
curl -X POST http://localhost:3000/api/test-alert \
  -H "Content-Type: application/json" \
  -d "{\"alertType\":\"humidity\"}"
```

**Test VOC Alert:**
```bash
curl -X POST http://localhost:3000/api/test-alert \
  -H "Content-Type: application/json" \
  -d "{\"alertType\":\"voc\"}"
```

## Expected Server Console Output

When email configuration is correct, you should see:

```
✅ Email configuration verified successfully
📧 Sender: your-email@gmail.com
📬 Recipients: recipient@example.com
✅ Test email sent successfully
✅ Alert email sent for temperature
```

## Troubleshooting

### "Email credentials not configured"
- Check that `.env` file exists in the `web/` folder
- Verify `EMAIL_USER` and `EMAIL_PASSWORD` are set

### "No alert recipients configured"
- Check that `ALERT_RECIPIENTS` is set in `.env`
- Ensure emails are comma-separated (no spaces)

### "Failed to send email"
- Verify your app password is correct
- For Gmail: ensure 2-Step Verification is enabled
- Check spam folder for test emails
- Try running: `npm install` to ensure nodemailer is installed

### "Invalid authenticator"
- You're using your regular password instead of an app password
- Generate a new app password at: https://myaccount.google.com/apppasswords

## Real-World Testing

To test with actual sensor data:
1. Send sensor readings from ESP32 that exceed thresholds
2. Wait for the automatic alert (30-minute cooldown applies)
3. Check server console for `✅ Alert email sent for [type]`

### Example: Trigger Temperature Alert

Set ESP32 to send temperature > 10°C (when produce thresholds are set for 0-4°C)

## Alert Cooldown

Remember: Each alert type has a 30-minute cooldown by default to prevent spam. You can adjust this in `.env`:

```env
ALERT_COOLDOWN_MINUTES=5  # Change to 5 minutes for testing
```

Restart the server after changing the `.env` file.
