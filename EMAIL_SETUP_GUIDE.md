# Email Notification Setup Guide

## Overview
Your cold storage system can now send email alerts when temperature, humidity, or VOC levels exceed safe thresholds.

## Features
- ✅ Email alerts for temperature, humidity, and VOC violations
- ✅ 30-minute cooldown to prevent spam
- ✅ Detailed alert information with current values and safe ranges
- ✅ Support for multiple recipients
- ✅ HTML-formatted emails for better readability

## Setup Instructions

### Step 1: Choose Your Email Service

The system supports Gmail, Outlook, Yahoo, and other email providers. Gmail is recommended for ease of setup.

### Step 2: Generate App Password (for Gmail)

**Important:** Never use your regular email password. Create an app-specific password:

#### Method 1: Direct Link (Easiest)
1. Go directly to: https://myaccount.google.com/apppasswords
2. You'll be prompted to sign in again
3. Under "App name" type: `Cold Storage Alerts`
4. Click **Create**
5. Copy the 16-character password shown (you'll use this in Step 3)
6. Click **Done**

#### Method 2: Through Google Account Settings
1. Go to your Google Account: https://myaccount.google.com/
2. Click **Security** in the left sidebar
3. Scroll down to "How you sign in to Google"
4. Click **2-Step Verification** (if not enabled, enable it first)
5. Scroll to the bottom and click **App passwords**
   - If you don't see "App passwords", ensure 2-Step Verification is ON
   - Some Google Workspace accounts may not have this option
6. Select app: **Mail**, Select device: **Other (Custom name)**
7. Type: `Cold Storage System`
8. Click **Generate**
9. Copy the 16-character password (spaces don't matter)

#### Troubleshooting "App passwords not showing":
- ✅ **Enable 2-Step Verification first** - App passwords only appear after 2FA is on
- ✅ **Wait 24 hours** - Sometimes it takes time after enabling 2-Step Verification
- ✅ **Use the direct link** - Try https://myaccount.google.com/apppasswords
- ✅ **Try a different browser** - Sometimes the option is hidden in certain browsers
- ✅ **Check account type** - Some Google Workspace accounts managed by organizations don't allow app passwords

#### Alternative: Use "Less Secure Apps" (Not Recommended)
If you can't generate an app password:
1. Go to: https://myaccount.google.com/lesssecureapps
2. Turn ON "Allow less secure apps"
3. Use your regular Gmail password in `emailConfig.js`
4. **Warning:** This is less secure and Google may disable it

### Step 3: Configure Email Settings

**IMPORTANT:** Edit the `.env` file in the `web/` folder (NOT `emailConfig.js`):

1. Navigate to `web/.env` (if it doesn't exist, copy from `web/.env.example`)
2. Update the following settings:

```env
# Email service provider
EMAIL_SERVICE=gmail

# Your email address (the sender)
EMAIL_USER=your-email@gmail.com

# Your 16-character app password from Step 2
EMAIL_PASSWORD=your-app-password-here

# Recipient emails (comma-separated, no spaces after commas)
ALERT_RECIPIENTS=admin@example.com,manager@example.com

# Alert cooldown in minutes (default: 30)
ALERT_COOLDOWN_MINUTES=30
```

**Example configuration:**
```env
EMAIL_SERVICE=gmail
EMAIL_USER=coldstorage@gmail.com
EMAIL_PASSWORD=abcd efgh ijkl mnop
ALERT_RECIPIENTS=alerts@company.com,boss@company.com
ALERT_COOLDOWN_MINUTES=30
```

**Security Note:** The `.env` file is automatically excluded from git to protect your credentials.

### Step 4: Alternative Email Providers

#### Outlook/Hotmail

```env
EMAIL_SERVICE=hotmail
EMAIL_USER=your-email@outlook.com
EMAIL_PASSWORD=your-password
```

#### Yahoo

```env
EMAIL_SERVICE=yahoo
EMAIL_USER=your-email@yahoo.com
EMAIL_PASSWORD=your-app-password
```

Note: Yahoo also requires app passwords. Generate from your Yahoo account security settings.

#### Custom SMTP Server

For custom SMTP servers, you'll need to modify `emailConfig.js` directly to use host/port configuration instead of service name.

### Step 5: Test Your Configuration

1. Install dependencies (if not already done):

   ```bash
   cd web
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. The server will automatically verify your email configuration on startup. Look for:

   ```
   ✅ Email configuration verified successfully
   📧 Sender: your-email@gmail.com
   📬 Recipients: recipient1@example.com
   ```

4. **Test email sending** - Open your browser console on the dashboard and run:

   ```javascript
   fetch('http://localhost:3000/api/test-email', { method: 'POST' })
     .then(r => r.json())
     .then(console.log);
   ```

   Or use curl:

   ```bash
   curl -X POST http://localhost:3000/api/test-email
   ```

5. Check your recipient email inbox (and spam folder) for the test email

6. **Test alert sending** - Trigger a specific alert type:

   ```javascript
   fetch('http://localhost:3000/api/test-alert', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ alertType: 'temperature' })
   }).then(r => r.json()).then(console.log);
   ```

### Step 6: Adjust Alert Settings

#### Change Alert Cooldown Period

In the `.env` file, modify the cooldown time (in minutes):

```env
ALERT_COOLDOWN_MINUTES=15  # 15 minutes
# or
ALERT_COOLDOWN_MINUTES=60  # 1 hour
# or
ALERT_COOLDOWN_MINUTES=5   # 5 minutes
```

#### Customize Alert Messages

Edit the `sendAlert()` function in [emailConfig.js](web/emailConfig.js) to customize email content, styling, or add additional information.

## SMS Notifications (Optional)

For SMS alerts, you can use email-to-SMS gateways provided by carriers:

### Common Carrier Email-to-SMS Gateways

Add these to `alertRecipients`:

- **Verizon:** `1234567890@vtext.com`
- **AT&T:** `1234567890@txt.att.net`
- **T-Mobile:** `1234567890@tmomail.net`
- **Sprint:** `1234567890@messaging.sprintpcs.com`
- **Cricket:** `1234567890@sms.cricketwireless.net`

Replace `1234567890` with the actual phone number.

**Note:** Email-to-SMS messages are usually limited to 160 characters and may not support HTML formatting.

## Advanced: Twilio SMS Integration

For professional SMS notifications:

1. Sign up at https://www.twilio.com/
2. Install Twilio SDK:
   ```bash
   npm install twilio
   ```
3. Get your Account SID and Auth Token from Twilio dashboard
4. Modify `emailConfig.js` to add Twilio support

## Troubleshooting

### Email Not Sending

1. **Check console logs** - Look for error messages
2. **Verify credentials** - Ensure email and app password are correct
3. **Check spam folder** - Emails might be filtered
4. **Test SMTP connection:**
   ```javascript
   transporter.verify((error, success) => {
     if (error) console.log(error);
     else console.log("Server is ready to send emails");
   });
   ```

### Gmail App Password Issues

- Ensure 2-Step Verification is enabled
- Use the app password, NOT your regular password
- Remove spaces from the 16-character app password

### Alerts Not Triggering

- Check that thresholds are configured correctly
- Verify sensor data is being received (`/api/metrics`)
- Check cooldown period hasn't prevented the alert

## Security Best Practices

- ✅ Use app-specific passwords, never your main email password
- ✅ Don't commit `emailConfig.js` with real credentials to Git
- ✅ Consider using environment variables for sensitive data
- ✅ Limit recipient list to authorized personnel only

## Example Environment Variables (Advanced)

Create a `.env` file:
```
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
ALERT_RECIPIENTS=email1@example.com,email2@example.com
```

Update `emailConfig.js` to use:
```javascript
require('dotenv').config();

const emailConfig = {
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
};

const alertRecipients = process.env.ALERT_RECIPIENTS.split(',');
```

Install dotenv:
```bash
npm install dotenv
```
