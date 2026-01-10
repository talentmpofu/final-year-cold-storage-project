/*
 * Cold Storage Unit - ESP32 Monitoring System
 * Real-time Temperature & Humidity Monitoring with Web Dashboard
 *
 * Hardware Required:
 * - ESP32 Development Board
 * - DHT22 Temperature & Humidity Sensor
 * - SGP41 VOC Sensor (I2C)
 * - SSD1306 OLED Display 128x64 (I2C)
 * - Relay for scrubbing system control
 * - Connecting wires
 *
 * DHT22 Wiring:
 * - VCC -> 3.3V (ESP32)
 * - GND -> GND (ESP32)
 * - DATA -> GPIO 4 (ESP32)
 * - Add 10K resistor between VCC and DATA
 *
 * SGP41 Wiring (I2C):
 * - VCC -> 3.3V (ESP32)
 * - GND -> GND (ESP32)
 * - SCL -> GPIO 22 (ESP32 default I2C SCL)
 * - SDA -> GPIO 21 (ESP32 default I2C SDA)
 *
 * OLED Display Wiring (I2C - shares with SGP41):
 * - VCC -> 3.3V (ESP32)
 * - GND -> GND (ESP32)
 * - SCL -> GPIO 22 (ESP32 default I2C SCL)
 * - SDA -> GPIO 21 (ESP32 default I2C SDA)
 *
 * Scrubbing System Relay:
 * - Control Pin -> GPIO 5 (ESP32)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// OLED Display settings
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// SGP41 I2C Address
#define SGP41_ADDRESS 0x59

// WiFi credentials - UPDATE THESE WITH YOUR NETWORK

const char *ssid = "Talent";
const char *password = "talent401";

// Backend API endpoint - UPDATE THIS WITH YOUR SERVER IP
const char *serverUrl = "http://172.20.10.2:3000/api/metrics";
const char *thresholdsUrl = "http://172.20.10.2:3000/api/thresholds";

// Pin definitions
#define DHT_PIN 4      // GPIO 4 for DHT22 data pin
#define DHT_TYPE DHT22 // DHT22 sensor type
#define NUM_READINGS 3 // Number of readings to average

// Single Relay Module (1 channel)
#define HUMIDIFIER_SCRUBBER_PIN 26 // GPIO 26 for humidifier + scrubber (4A total)

// 4-Channel Relay Module
#define PELTIER_1_PUMP_PIN 18 // GPIO 18 for Peltier 1 + Water Pump (8A)
#define PELTIER_2_FAN_PIN 19  // GPIO 19 for Peltier 2 + All Fans (6.5A)
#define PELTIER_3_PIN 23      // GPIO 23 for Peltier 3 (6A)
#define PELTIER_4_PIN 25      // GPIO 25 for Peltier 4 (6A)

// Default control thresholds (will be updated from server)
float VOC_THRESHOLD = 30000; // VOC raw threshold (clean air: ~25000, polluted: >30000)
float TEMP_MIN = 2.0;        // Target minimum temperature (°C)
float TEMP_MAX = 4.0;        // Target maximum temperature (°C)
float HUMIDITY_MIN = 85.0;   // Target minimum humidity (%)
float HUMIDITY_MAX = 95.0;   // Target maximum humidity (%)

// Last threshold update time
unsigned long lastThresholdUpdate = 0;
const unsigned long THRESHOLD_UPDATE_INTERVAL = 30000; // Update every 30 seconds

// Calibration offsets (adjust based on known reference values)
#define TEMP_OFFSET 0.0 // No calibration - raw DHT22 reading
#define HUM_OFFSET 0.0  // No calibration - raw DHT22 reading

// Create DHT sensor object
DHT dht(DHT_PIN, DHT_TYPE);

// VOC sensor variables
uint16_t vocRaw = 0;

// Variables to store sensor readings
float temperature = 0.0;
float humidity = 0.0;
float vocIndex = 0.0;
int failedReadings = 0;
bool sgpReady = false;

// Relay status tracking
bool coolingActive = false;
bool pumpActive = false;
bool humidifierScrubberActive = false;

// Function to get averaged sensor readings
bool getAveragedReadings(float &avgTemp, float &avgHum)
{
  float tempSum = 0.0;
  float humSum = 0.0;
  int validReadings = 0;

  // Take multiple readings
  for (int i = 0; i < NUM_READINGS; i++)
  {
    float t = dht.readTemperature();
    float h = dht.readHumidity();

    // Check if reading is valid
    if (!isnan(t) && !isnan(h))
    {
      // Additional validation - check if values are in reasonable range
      if (t >= -40 && t <= 80 && h >= 0 && h <= 100)
      {
        tempSum += t;
        humSum += h;
        validReadings++;
      }
    }

    // Wait between readings (DHT22 needs at least 2 seconds)
    if (i < NUM_READINGS - 1)
    {
      delay(2500);
    }
  }

  // Calculate averages if we have valid readings
  if (validReadings > 0)
  {
    avgTemp = (tempSum / validReadings) + TEMP_OFFSET; // Apply temperature calibration
    avgHum = (humSum / validReadings) + HUM_OFFSET;    // Apply humidity calibration

    // Ensure humidity stays within valid range (0-100%)
    if (avgHum > 100.0)
      avgHum = 100.0;
    if (avgHum < 0.0)
      avgHum = 0.0;

    failedReadings = 0;
    return true;
  }

  failedReadings++;
  return false;
}

// Simple function to read VOC from SGP41
uint16_t readSGP41_VOC()
{
  // SGP41 execute conditioning command: 0x2612
  Wire.beginTransmission(SGP41_ADDRESS);
  Wire.write(0x26);
  Wire.write(0x12);
  // Add default humidity (50% RH) and temperature (25°C) compensation
  Wire.write(0x80);
  Wire.write(0x00);
  Wire.write(0xA2); // 50% RH
  Wire.write(0x66);
  Wire.write(0x66);
  Wire.write(0x93); // 25°C
  if (Wire.endTransmission() != 0)
  {
    return 0;
  }

  delay(50); // Wait for measurement (SGP41 needs 30ms)

  // Read 6 bytes (VOC: 2 bytes + CRC, NOx: 2 bytes + CRC)
  uint8_t bytesReceived = Wire.requestFrom((uint8_t)SGP41_ADDRESS, (uint8_t)6);

  if (bytesReceived == 6)
  {
    uint8_t voc_msb = Wire.read();
    uint8_t voc_lsb = Wire.read();
    Wire.read(); // CRC for VOC
    uint8_t nox_msb = Wire.read();
    uint8_t nox_lsb = Wire.read();
    Wire.read(); // CRC for NOx

    return (voc_msb << 8) | voc_lsb;
  }

  return 0;
}

// Function to update OLED display
void updateDisplay()
{
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);

  // Title
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.println("Cold Storage Unit");
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

  // Temperature
  display.setTextSize(1);
  display.setCursor(0, 14);
  display.print("Temp     : ");
  display.print(temperature, 1);
  display.print(" C");
  if (temperature > TEMP_MAX || temperature < TEMP_MIN)
  {
    display.print(" !");
  }

  // Humidity
  display.setCursor(0, 26);
  display.print("Humidity : ");
  display.print(humidity, 1);
  display.print(" %");
  if (humidity > HUMIDITY_MAX || humidity < HUMIDITY_MIN)
  {
    display.print(" !");
  }

  // VOC
  display.setCursor(0, 38);
  display.print("Ethyl/VOC: ");
  display.print(vocRaw / 1000.0, 1);
  display.print("ppm");

  // Debug: print to serial
  Serial.printf("VOC Check: vocRaw=%d, threshold=%.0f, show alert=%d\n",
                vocRaw, VOC_THRESHOLD, (vocRaw > VOC_THRESHOLD));

  if (vocRaw > VOC_THRESHOLD)
  {
    display.print("!");
  }

  // System Status
  display.setCursor(0, 50);
  display.print("Status: ");
  if (coolingActive)
    display.print("C");
  else
    display.print("-");
  if (pumpActive)
    display.print("P");
  else
    display.print("-");
  if (humidifierScrubberActive)
    display.print("H");
  else
    display.print("-");

  display.display();
}

// Function to control cooling system (4 Peltiers + Water Pump + Fans together)
void controlCooling(float temp)
{
  if (temp > TEMP_MAX)
  {
    if (!coolingActive)
    {
      // Activate all 4 cooling channels simultaneously
      digitalWrite(PELTIER_1_PUMP_PIN, HIGH); // Peltier 1 + Water Pump (8A)
      digitalWrite(PELTIER_2_FAN_PIN, HIGH);  // Peltier 2 + All Fans (6.5A)
      digitalWrite(PELTIER_3_PIN, HIGH);      // Peltier 3 (6A)
      digitalWrite(PELTIER_4_PIN, HIGH);      // Peltier 4 (6A)
      coolingActive = true;
      pumpActive = true;
      Serial.println("❄️ Temperature HIGH! Cooling system ACTIVATED");
      Serial.println("   → Peltier 1 + Pump ON (8A)");
      Serial.println("   → Peltier 2 + Fans ON (6.5A)");
      Serial.println("   → Peltier 3 ON (6A)");
      Serial.println("   → Peltier 4 ON (6A)");
    }
  }
  else if (temp < TEMP_MIN)
  {
    if (coolingActive)
    {
      // Deactivate entire cooling system
      digitalWrite(PELTIER_1_PUMP_PIN, LOW);
      digitalWrite(PELTIER_2_FAN_PIN, LOW);
      digitalWrite(PELTIER_3_PIN, LOW);
      digitalWrite(PELTIER_4_PIN, LOW);
      coolingActive = false;
      pumpActive = false;
      Serial.println("✓ Temperature OK. Cooling system DEACTIVATED (all components off)");
    }
  }
}

// Function to control humidifier + scrubber (combined on single relay)
// Activates when EITHER humidity is low OR VOC is high
void controlHumidifierScrubber(float hum, float vocLevel)
{
  bool shouldActivate = (hum < HUMIDITY_MIN) || (vocLevel > VOC_THRESHOLD);

  if (shouldActivate)
  {
    if (!humidifierScrubberActive)
    {
      digitalWrite(HUMIDIFIER_SCRUBBER_PIN, HIGH);
      humidifierScrubberActive = true;
      if (hum < HUMIDITY_MIN && vocLevel > VOC_THRESHOLD)
        Serial.println("⚠️ Humidity LOW & VOC HIGH! Humidifier+Scrubber ACTIVATED");
      else if (hum < HUMIDITY_MIN)
        Serial.println("💧 Humidity LOW! Humidifier+Scrubber ACTIVATED");
      else
        Serial.println("⚠️ VOC HIGH! Humidifier+Scrubber ACTIVATED");
    }
  }
  else
  {
    // Turn off only when both conditions are OK
    if (humidifierScrubberActive && hum > HUMIDITY_MAX && vocLevel < (VOC_THRESHOLD * 0.8))
    {
      digitalWrite(HUMIDIFIER_SCRUBBER_PIN, LOW);
      humidifierScrubberActive = false;
      Serial.println("✓ Humidity & VOC OK. Humidifier+Scrubber DEACTIVATED");
    }
  }
}

// Function to send data to backend API
void sendDataToServer(float temp, float hum, float voc)
{
  if (WiFi.status() == WL_CONNECTED)
  {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    // Create JSON payload
    StaticJsonDocument<200> doc;
    doc["temperature"]["value"] = temp;
    doc["humidity"]["value"] = hum;
    doc["vocs"]["value"] = voc; // VOC index value (also used for ethylene monitoring)
    doc["timestamp"] = millis();

    String jsonString;
    serializeJson(doc, jsonString);

    // Send POST request
    int httpResponseCode = http.POST(jsonString);

    if (httpResponseCode > 0)
    {
      Serial.print("✓ Data sent to server. Response: ");
      Serial.println(httpResponseCode);
    }
    else
    {
      Serial.print("✗ Error sending data: ");
      Serial.println(httpResponseCode);
    }

    http.end();
  }
  else
  {
    Serial.println("✗ WiFi disconnected. Reconnecting...");
    WiFi.reconnect();
  }
}

// Function to fetch updated thresholds from server
void updateThresholds()
{
  if (WiFi.status() == WL_CONNECTED)
  {
    HTTPClient http;
    http.begin(thresholdsUrl);

    int httpResponseCode = http.GET();

    if (httpResponseCode == 200)
    {
      String payload = http.getString();
      StaticJsonDocument<256> doc;
      DeserializationError error = deserializeJson(doc, payload);

      if (!error)
      {
        // Update temperature thresholds
        if (doc.containsKey("temperature"))
        {
          TEMP_MIN = doc["temperature"]["min"];
          TEMP_MAX = doc["temperature"]["max"];
        }

        // Update humidity thresholds
        if (doc.containsKey("humidity"))
        {
          HUMIDITY_MIN = doc["humidity"]["min"];
          HUMIDITY_MAX = doc["humidity"]["max"];
        }

        // Update VOC threshold
        if (doc.containsKey("voc"))
        {
          VOC_THRESHOLD = doc["voc"];
        }

        Serial.println("✓ Thresholds updated from server:");
        Serial.printf("  Temperature: %.1f–%.1f°C\n", TEMP_MIN, TEMP_MAX);
        Serial.printf("  Humidity: %.1f–%.1f%%\n", HUMIDITY_MIN, HUMIDITY_MAX);
        Serial.printf("  VOC: %.0f\n", VOC_THRESHOLD);
      }
      else
      {
        Serial.println("⚠️  Failed to parse threshold data");
      }
    }

    http.end();
  }
}

void setup()
{
  // Start serial communication at 115200 baud rate
  Serial.begin(115200);

  // Wait for serial connection
  delay(1000);

  Serial.println("\n=================================");
  Serial.println("Cold Storage Unit - ESP32");
  Serial.println("Temperature Monitoring System");
  Serial.println("=================================\n");

  // Connect to WiFi
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20)
  {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println("\n✓ WiFi connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println("\n✗ WiFi connection failed!");
    Serial.println("Check SSID and password");
  }

  // Initialize relay pins
  pinMode(PELTIER_1_PUMP_PIN, OUTPUT);      // 4-CH Relay 1
  pinMode(PELTIER_2_FAN_PIN, OUTPUT);       // 4-CH Relay 2
  pinMode(PELTIER_3_PIN, OUTPUT);           // 4-CH Relay 3
  pinMode(PELTIER_4_PIN, OUTPUT);           // 4-CH Relay 4
  pinMode(HUMIDIFIER_SCRUBBER_PIN, OUTPUT); // Single Relay

  digitalWrite(PELTIER_1_PUMP_PIN, LOW);      // Start with peltier 1 + pump off
  digitalWrite(PELTIER_2_FAN_PIN, LOW);       // Start with peltier 2 + fans off
  digitalWrite(PELTIER_3_PIN, LOW);           // Start with peltier 3 off
  digitalWrite(PELTIER_4_PIN, LOW);           // Start with peltier 4 off
  digitalWrite(HUMIDIFIER_SCRUBBER_PIN, LOW); // Start with humidifier+scrubber off

  Serial.println("\n=== RELAY CONFIGURATION (5 channels total) ===");
  Serial.println("Single Relay Module (1 channel):");
  Serial.println("  • GPIO 26: Humidifier + Scrubber (4A combined) ✓");
  Serial.println("\n4-Channel Relay Module:");
  Serial.println("  • CH1 (GPIO 18): Peltier 1 + Water Pump (8A) ✓");
  Serial.println("  • CH2 (GPIO 19): Peltier 2 + All Fans (6.5A) ✓");
  Serial.println("  • CH3 (GPIO 23): Peltier 3 (6A) ✓");
  Serial.println("  • CH4 (GPIO 25): Peltier 4 (6A) ✓");
  Serial.println("\nTotal cooling load: 26.5A (all channels under 10A) ✓");
  Serial.println("Note: Humidifier+Scrubber share single relay (activate together)");
  Serial.println("============================================\n");

  // Initialize I2C for SGP41
  Wire.begin();
  Serial.println("I2C bus initialized");

  // Scan I2C bus to find devices FIRST
  Serial.println("Scanning I2C bus...");
  byte devicesFound = 0;
  byte oledAddress = 0x3C; // Default address
  for (byte address = 1; address < 127; address++)
  {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();

    if (error == 0)
    {
      Serial.print("I2C device found at address 0x");
      if (address < 16)
        Serial.print("0");
      Serial.println(address, HEX);
      devicesFound++;

      // Detect OLED address (usually 0x3C or 0x3D)
      if (address == 0x3C || address == 0x3D)
      {
        oledAddress = address;
        Serial.print("  -> Detected OLED at 0x");
        Serial.println(address, HEX);
      }
      else if (address == SGP41_ADDRESS)
      {
        Serial.println("  -> Detected SGP41 VOC Sensor");
        sgpReady = true;
      }
    }
  }

  if (devicesFound == 0)
  {
    Serial.println("No I2C devices found!");
  }
  else
  {
    Serial.print("Found ");
    Serial.print(devicesFound);
    Serial.println(" I2C device(s)");
  }

  // Initialize OLED display with detected address
  Serial.print("Initializing OLED at 0x");
  Serial.println(oledAddress, HEX);

  if (!display.begin(SSD1306_SWITCHCAPVCC, oledAddress))
  {
    Serial.println("✗ OLED display initialization FAILED!");
    Serial.println("  Check wiring: VCC->3.3V, GND->GND, SCL->GPIO22, SDA->GPIO21");
  }
  else
  {
    Serial.println("✓ OLED display initialized successfully!");
    display.clearDisplay();
    display.setTextSize(2);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("COLD");
    display.println("STORAGE");
    display.setTextSize(1);
    display.setCursor(0, 45);
    display.println("Starting...");
    display.display();
    delay(2000);
  }

  // Continue with sensor initialization

  // Initialize DHT sensor
  dht.begin();
  Serial.println("DHT22 sensor initialized");
  Serial.println("Waiting for sensors to stabilize...\n");
  delay(3000);

  // Perform initial reading to clear any errors
  dht.readTemperature();
  dht.readHumidity();
  delay(2000);
}

void loop()
{
  // Update thresholds periodically
  if (millis() - lastThresholdUpdate >= THRESHOLD_UPDATE_INTERVAL)
  {
    updateThresholds();
    lastThresholdUpdate = millis();
  }

  // Get averaged readings
  if (getAveragedReadings(temperature, humidity))
  {
    // Read VOC sensor if available
    if (sgpReady)
    {
      vocRaw = readSGP41_VOC();

      if (vocRaw > 0)
      {
        // Use raw value directly (typical clean air: 20000-30000)
        vocIndex = (float)vocRaw;
      }
      else
      {
        Serial.println("⚠ VOC sensor reading failed");
      }
    }

    // Control all systems
    controlCooling(temperature);
    controlHumidifierScrubber(humidity, vocIndex);

    // Display readings on Serial Monitor
    Serial.println("--- Sensor Readings ---");
    Serial.print("Temperature: ");
    Serial.print(temperature, 1); // Show 1 decimal place
    Serial.println(" °C");

    Serial.print("Humidity: ");
    Serial.print(humidity, 1);
    Serial.println(" %");

    if (sgpReady && !isnan(vocIndex))
    {
      Serial.print("VOC Index: ");
      Serial.print(vocIndex, 0);
      Serial.print(" (Threshold: ");
      Serial.print(VOC_THRESHOLD, 0);
      Serial.println(")");
    }

    // Display system status
    Serial.print("Systems: Cooling=");
    Serial.print(coolingActive ? "ON" : "OFF");
    Serial.print(" | Pump=");
    Serial.print(pumpActive ? "ON" : "OFF");
    Serial.print(" | Humidifier+Scrubber=");
    Serial.println(humidifierScrubberActive ? "ON" : "OFF");

    // Check if temperature is in target range
    if (temperature >= TEMP_MIN && temperature <= TEMP_MAX)
    {
      Serial.println("Status: ✓ Temperature ON TARGET");
    }
    else if (temperature < TEMP_MIN)
    {
      Serial.println("Status: ⚠ Temperature BELOW TARGET");
    }
    else
    {
      Serial.println("Status: ⚠ Temperature ABOVE TARGET");
    }

    // Send data to web dashboard
    sendDataToServer(temperature, humidity, sgpReady ? vocIndex : 0.0);

    // Update OLED display
    updateDisplay();

    Serial.println("----------------------\n");
  }
  else
  {
    Serial.print("ERROR: Failed to read from DHT sensor! (Attempt ");
    Serial.print(failedReadings);
    Serial.println(")");

    if (failedReadings >= 3)
    {
      Serial.println("⚠ Check sensor wiring and power supply!");
      Serial.println("⚠ Ensure 10K pull-up resistor is connected\n");
    }

    // Update display with error message
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Cold Storage Unit");
    display.setCursor(0, 20);
    display.println("ERROR: Sensor fail!");
    display.setCursor(0, 30);
    display.print("Attempts: ");
    display.println(failedReadings);
    display.display();
  }

  // Wait before next reading cycle
  delay(10000); // 10 seconds between cycles
}
