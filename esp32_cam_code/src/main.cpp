/**
 * ESP32-CAM Produce Detection Module
 * Captures images and sends to backend for YOLO inference
 * Auto-detects produce type to adjust cold storage thresholds
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "esp_http_client.h"

// WiFi credentials
const char *ssid = "Talent";
const char *password = "talent401";

// Server endpoint
const char *serverUrl = "http://172.20.10.3:3000/api/upload-image";

// Camera pins for AI-Thinker ESP32-CAM
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// Flash LED
#define FLASH_LED_PIN 4

// Timing
unsigned long lastCaptureTime = 0;
const unsigned long captureInterval = 300000; // Capture every 5 minutes

// Function declarations
void connectWiFi();
bool initCamera();
void captureAndSendImage();

void setup()
{
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n╔═══════════════════════════════════════╗");
  Serial.println("║  ESP32-CAM Produce Detection         ║");
  Serial.println("╚═══════════════════════════════════════╝\n");

  // Initialize flash LED
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  // Connect to WiFi
  connectWiFi();

  // Initialize camera
  if (initCamera())
  {
    Serial.println("✓ Camera initialized successfully\n");
  }
  else
  {
    Serial.println("✗ Camera initialization failed!");
    Serial.println("⚠️  Restarting ESP32-CAM...\n");
    delay(3000);
    ESP.restart();
  }

  Serial.println("🚀 ESP32-CAM ready for produce detection\n");

  // Capture first image immediately on startup
  Serial.println("📸 Taking initial capture...");
  captureAndSendImage();
  lastCaptureTime = millis();
}

void loop()
{
  // Capture and send image at regular intervals
  if (millis() - lastCaptureTime >= captureInterval)
  {
    captureAndSendImage();
    lastCaptureTime = millis();
  }

  delay(100);
}

void connectWiFi()
{
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Serial.print("📡 Connecting to WiFi: ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30)
  {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println("✓ WiFi connected successfully!");
    Serial.print("📍 IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("📶 Signal Strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.print("🌐 Gateway: ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("🖧  Subnet Mask: ");
    Serial.println(WiFi.subnetMask());
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }
  else
  {
    Serial.println("\n✗ WiFi connection failed!");
    Serial.println("⚠️  Please check:");
    Serial.println("   1. WiFi SSID and password are correct");
    Serial.println("   2. Router is powered on and in range");
    Serial.println("   3. WiFi network is 2.4GHz (ESP32 doesn't support 5GHz)");
    Serial.println("\n⚠️  Restarting ESP32-CAM in 5 seconds...\n");
    delay(5000);
    ESP.restart();
  }
}

bool initCamera()
{
  Serial.println("📷 Initializing camera...");

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Optimized for produce quality inspection (ripening, rotting detection)
  if (psramFound())
  {
    config.frame_size = FRAMESIZE_UXGA; // 1600x1200 - high detail for inspection
    config.jpeg_quality = 8;            // Good balance of quality and file size
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
  }
  else
  {
    config.frame_size = FRAMESIZE_XGA; // 1024x768
    config.jpeg_quality = 10;
    config.fb_count = 1;
  }

  // Initialize camera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK)
  {
    Serial.printf("✗ Camera init failed with error 0x%x\n", err);
    return false;
  }

  // Optimized for produce inspection - detect ripening & rotting
  sensor_t *s = esp_camera_sensor_get();
  if (s != NULL)
  {
    s->set_brightness(s, 0);                 // Neutral brightness for true colors
    s->set_contrast(s, 1);                   // Slight contrast boost for spots/blemishes
    s->set_saturation(s, 2);                 // Higher saturation to detect color changes (ripening)
    s->set_sharpness(s, 1);                  // Better sharpness for texture detail (mold, soft spots)
    s->set_whitebal(s, 1);                   // Enable white balance for accurate colors
    s->set_awb_gain(s, 1);                   // Auto white balance gain
    s->set_wb_mode(s, 0);                    // Auto white balance mode
    s->set_exposure_ctrl(s, 1);              // Auto exposure
    s->set_aec2(s, 1);                       // Auto exposure DSP
    s->set_ae_level(s, 0);                   // Neutral exposure level
    s->set_gain_ctrl(s, 1);                  // Enable auto gain
    s->set_agc_gain(s, 0);                   // Auto gain
    s->set_gainceiling(s, (gainceiling_t)2); // Moderate gain for low light
    s->set_bpc(s, 0);                        // Disable BPC to see actual spots
    s->set_wpc(s, 1);                        // White pixel correction
    s->set_raw_gma(s, 1);                    // Gamma correction for better color range
    s->set_lenc(s, 1);                       // Lens correction
    s->set_hmirror(s, 1);                    // Keep rotation fix
    s->set_vflip(s, 1);                      // Keep rotation fix
    s->set_dcw(s, 1);                        // Downsize enable
    s->set_colorbar(s, 0);                   // No test pattern
  }

  return true;
}

void captureAndSendImage()
{
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Serial.println("📸 Starting image capture...");

  // Turn on flash for better lighting
  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(300); // Let flash stabilize and allow auto-exposure to adjust

  // Discard first frame (often cached/old)
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb)
  {
    esp_camera_fb_return(fb);
    delay(100); // Wait a bit
  }

  // Capture fresh image
  fb = esp_camera_fb_get();

  // Turn off flash
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!fb)
  {
    Serial.println("✗ Camera capture failed!");
    return;
  }

  Serial.printf("✓ Image captured successfully!\n");
  Serial.printf("   Size: %d bytes\n", fb->len);
  Serial.printf("   Resolution: %dx%d pixels\n", fb->width, fb->height);
  Serial.printf("   Format: JPEG\n");

  // Send image to server
  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println("✗ WiFi disconnected!");
    Serial.println("⚠️  Attempting to reconnect...");
    esp_camera_fb_return(fb);
    connectWiFi();
    return;
  }

  Serial.println("\n📤 Uploading to web app...");
  Serial.printf("   Server: %s\n", serverUrl);

  HTTPClient http;
  http.begin(serverUrl);
  http.setTimeout(15000); // 15 second timeout

  // Build proper multipart/form-data
  String boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";

  String contentType = "multipart/form-data; boundary=" + boundary;
  http.addHeader("Content-Type", contentType);

  // Build multipart body
  String header = "--" + boundary + "\r\n";
  header += "Content-Disposition: form-data; name=\"source\"\r\n\r\n";
  header += "esp32cam\r\n";
  header += "--" + boundary + "\r\n";
  header += "Content-Disposition: form-data; name=\"image\"; filename=\"esp32cam.jpg\"\r\n";
  header += "Content-Type: image/jpeg\r\n\r\n";

  String footer = "\r\n--" + boundary + "--\r\n";

  uint32_t totalLen = header.length() + fb->len + footer.length();

  Serial.printf("   Total payload: %d bytes\n", totalLen);

  // Allocate buffer for complete request
  uint8_t *requestBuffer = (uint8_t *)malloc(totalLen);
  if (requestBuffer == NULL)
  {
    Serial.println("✗ Failed to allocate memory!");
    esp_camera_fb_return(fb);
    http.end();
    return;
  }

  // Build complete request
  uint32_t pos = 0;
  memcpy(requestBuffer + pos, header.c_str(), header.length());
  pos += header.length();
  memcpy(requestBuffer + pos, fb->buf, fb->len);
  pos += fb->len;
  memcpy(requestBuffer + pos, footer.c_str(), footer.length());

  Serial.println("   Sending data...");

  // Send POST request
  int httpResponseCode = http.POST(requestBuffer, totalLen);

  free(requestBuffer);

  if (httpResponseCode > 0)
  {
    Serial.printf("\n✓ Upload successful! (HTTP %d)\n", httpResponseCode);

    String response = http.getString();
    Serial.println("\n📥 Server response:");
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Serial.println(response);
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }
  else
  {
    Serial.printf("\n✗ Upload failed! (HTTP %d)\n", httpResponseCode);
    Serial.printf("   Error: %s\n", http.errorToString(httpResponseCode).c_str());

    if (httpResponseCode == -1)
    {
      Serial.println("   → Connection refused. Is the server running?");
    }
    else if (httpResponseCode == -11)
    {
      Serial.println("   → Timeout. Check network connection.");
    }
  }

  http.end();

  // Return frame buffer
  esp_camera_fb_return(fb);

  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}
