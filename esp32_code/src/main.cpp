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
 * 4-Channel Relay Module (active-LOW type, SRD-05VDC-SL-C):
 * - IN1 -> GPIO 23 (Humidifier 12V)
 * - IN2 -> GPIO 19 (Cold-side fans, grouped)
 * - IN3 -> GPIO 18 (Water pump 12V)
 * - IN4 -> GPIO 17 (Scrubber 12V)
 *
 * Peltier MOSFET (IRLZ44N):
 * - Gate -> GPIO 26 (through ~100R series resistor)
 * - Source -> GND
 * - Drain -> Peltier negative terminal (low-side switching)
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

// WiFi hotspot credentials (only network to use)
const char *ssid = "Talent";
const char *password = "talent401";

// Backend API endpoint - UPDATE THIS WITH YOUR SERVER IP
const char *serverUrl = "http://192.168.137.1:3000/api/metrics";
const char *thresholdsUrl = "http://192.168.137.1:3000/api/thresholds";

// Pin definitions
#define DHT_PIN 4      // GPIO 4 for DHT22 data pin
#define DHT_TYPE DHT22 // DHT22 sensor type
#define NUM_READINGS 3 // Number of readings to average

// 4-channel relay module (active-LOW)
#define RELAY_ACTIVE LOW
#define RELAY_INACTIVE HIGH
#define RELAY_HUMIDIFIER_PIN 23
#define RELAY_COLD_FANS_PIN 19
#define RELAY_PUMP_PIN 18
#define RELAY_SCRUBBER_PIN 17

// Peltier MOSFET gate control (IRLZ44N)
#define PELTIER_MOSFET_PIN 26

// Default control thresholds (will be updated from server)
float VOC_THRESHOLD = 30000; // VOC raw threshold (clean air: ~25000, polluted: >30000)
float TEMP_MIN = 2.0;        // Target minimum temperature (°C)
float TEMP_MAX = 4.0;        // Target maximum temperature (°C)
float HUMIDITY_MIN = 85.0;   // Target minimum humidity (%)
float HUMIDITY_MAX = 95.0;   // Target maximum humidity (%)

// Cooling controller tuning (hybrid PID + relay-safe supervision)
const float PID_KP = 45.0;
const float PID_KI = 0.20;
const float PID_KD = 6.0;
const float PID_INTEGRAL_MIN = -200.0;
const float PID_INTEGRAL_MAX = 200.0;
const unsigned long PELTIER_WINDOW_MS = 20000; // Time-proportion window
const float RELAY_ON_DEMAND_PCT = 20.0;
const float RELAY_OFF_DEMAND_PCT = 5.0;
const unsigned long RELAY_MIN_ON_MS = 60000;
const unsigned long RELAY_MIN_OFF_MS = 60000;

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
bool peltierActive = false;
bool coldFansActive = false;
bool pumpActive = false;
bool humidifierActive = false;
bool scrubberActive = false;
float coolingDemandPct = 0.0;

float pidIntegral = 0.0;
float pidPrevError = 0.0;
unsigned long pidPrevMs = 0;
unsigned long peltierWindowStartMs = 0;
unsigned long coldPathLastToggleMs = 0;

const bool RUN_ACTUATOR_SELF_TEST = true;
const unsigned long SELF_TEST_ON_MS = 1500;
const unsigned long SELF_TEST_GAP_MS = 500;

void setRelay(uint8_t relayPin, bool enabled)
{
  digitalWrite(relayPin, enabled ? RELAY_ACTIVE : RELAY_INACTIVE);
}

void runActuatorSelfTest()
{
  if (!RUN_ACTUATOR_SELF_TEST)
  {
    Serial.println("Actuator self-test skipped (disabled)");
    return;
  }

  Serial.println("\n=== STARTUP ACTUATOR SELF-TEST ===");
  Serial.println("WARNING: Loads will turn ON one-by-one briefly.");

  Serial.println("[1/5] Humidifier relay ON");
  setRelay(RELAY_HUMIDIFIER_PIN, true);
  delay(SELF_TEST_ON_MS);
  setRelay(RELAY_HUMIDIFIER_PIN, false);
  delay(SELF_TEST_GAP_MS);

  Serial.println("[2/5] Cold-side fans relay ON");
  setRelay(RELAY_COLD_FANS_PIN, true);
  delay(SELF_TEST_ON_MS);
  setRelay(RELAY_COLD_FANS_PIN, false);
  delay(SELF_TEST_GAP_MS);

  Serial.println("[3/5] Water pump relay ON");
  setRelay(RELAY_PUMP_PIN, true);
  delay(SELF_TEST_ON_MS);
  setRelay(RELAY_PUMP_PIN, false);
  delay(SELF_TEST_GAP_MS);

  Serial.println("[4/5] Scrubber relay ON");
  setRelay(RELAY_SCRUBBER_PIN, true);
  delay(SELF_TEST_ON_MS);
  setRelay(RELAY_SCRUBBER_PIN, false);
  delay(SELF_TEST_GAP_MS);

  Serial.println("[5/5] Peltier MOSFET ON");
  digitalWrite(PELTIER_MOSFET_PIN, HIGH);
  delay(SELF_TEST_ON_MS);
  digitalWrite(PELTIER_MOSFET_PIN, LOW);

  Serial.println("Self-test complete. All actuators set to OFF.");
  Serial.println("==================================\n");
}

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
  if (peltierActive)
    display.print("M");
  else
    display.print("-");
  if (coldFansActive)
    display.print("F");
  else
    display.print("-");
  if (pumpActive)
    display.print("P");
  else
    display.print("-");
  if (humidifierActive)
    display.print("H");
  else
    display.print("-");
  if (scrubberActive)
    display.print("S");
  else
    display.print("-");

  display.display();
}

// Hybrid cooling control:
// - PID-style demand drives Peltier via time-proportioning (MOSFET-safe).
// - Relays (fans + pump) are demand-gated with minimum ON/OFF timing.
void controlCooling(float temp)
{
  const unsigned long now = millis();
  const float tempSetpoint = (TEMP_MIN + TEMP_MAX) * 0.5f;

  if (pidPrevMs == 0)
  {
    pidPrevMs = now;
    peltierWindowStartMs = now;
    coldPathLastToggleMs = now - RELAY_MIN_OFF_MS;
  }

  const float dt = max(0.001f, (now - pidPrevMs) / 1000.0f);
  pidPrevMs = now;

  // Cooling-only loop: error > 0 means chamber is warmer than setpoint.
  const float error = temp - tempSetpoint;
  if (temp <= TEMP_MIN)
  {
    // Hard floor: never cool below minimum threshold.
    pidIntegral = 0.0;
    pidPrevError = error;
    coolingDemandPct = 0.0;
  }
  else
  {
    pidIntegral += error * dt;
    pidIntegral = constrain(pidIntegral, PID_INTEGRAL_MIN, PID_INTEGRAL_MAX);
    const float derivative = (error - pidPrevError) / dt;
    pidPrevError = error;

    const float pidOutput = (PID_KP * error) + (PID_KI * pidIntegral) + (PID_KD * derivative);
    coolingDemandPct = constrain(pidOutput, 0.0f, 100.0f);
  }

  // Time-proportioning window for MOSFET drive.
  if ((now - peltierWindowStartMs) >= PELTIER_WINDOW_MS)
  {
    peltierWindowStartMs = now;
  }

  const bool forceCoolingOn = temp > TEMP_MAX;
  const bool forceCoolingOff = temp <= TEMP_MIN;

  const unsigned long peltierOnMs = (unsigned long)(PELTIER_WINDOW_MS * (coolingDemandPct / 100.0f));
  bool peltierShouldBeOn = (coolingDemandPct > 0.1f) && ((now - peltierWindowStartMs) < peltierOnMs);
  if (forceCoolingOn)
    peltierShouldBeOn = true;
  else if (forceCoolingOff)
    peltierShouldBeOn = false;

  if (peltierShouldBeOn != peltierActive)
  {
    digitalWrite(PELTIER_MOSFET_PIN, peltierShouldBeOn ? HIGH : LOW);
    peltierActive = peltierShouldBeOn;
    Serial.printf("Peltier MOSFET %s (Demand %.1f%%)\n", peltierActive ? "ON" : "OFF", coolingDemandPct);
  }

  // Relay-safe supervisor for fans + pump (single cold path).
  bool coldPathDemand = coldFansActive;
  if (forceCoolingOn)
    coldPathDemand = true;
  else if (forceCoolingOff)
    coldPathDemand = false;
  else if (coolingDemandPct >= RELAY_ON_DEMAND_PCT)
    coldPathDemand = true;
  else if (coolingDemandPct <= RELAY_OFF_DEMAND_PCT)
    coldPathDemand = false;

  const unsigned long minDwell = coldFansActive ? RELAY_MIN_ON_MS : RELAY_MIN_OFF_MS;
  const bool canToggleRelays = forceCoolingOn || forceCoolingOff || ((now - coldPathLastToggleMs) >= minDwell);

  if (coldPathDemand != coldFansActive && canToggleRelays)
  {
    setRelay(RELAY_COLD_FANS_PIN, coldPathDemand);
    setRelay(RELAY_PUMP_PIN, coldPathDemand);

    coldFansActive = coldPathDemand;
    pumpActive = coldPathDemand;
    coldPathLastToggleMs = now;

    Serial.printf("Cold path relays %s (Demand %.1f%%)\n", coldPathDemand ? "ON" : "OFF", coolingDemandPct);
  }

  coolingActive = peltierActive || coldFansActive || pumpActive;
}

// Function to control humidifier relay independently
void controlHumidifier(float hum)
{
  if (hum < HUMIDITY_MIN)
  {
    if (!humidifierActive)
    {
      setRelay(RELAY_HUMIDIFIER_PIN, true);
      humidifierActive = true;
      Serial.println("💧 Humidity LOW! Humidifier ACTIVATED");
    }
  }
  else if (hum > HUMIDITY_MAX)
  {
    if (humidifierActive)
    {
      setRelay(RELAY_HUMIDIFIER_PIN, false);
      humidifierActive = false;
      Serial.println("✓ Humidity in range. Humidifier DEACTIVATED");
    }
  }
}

// Function to control scrubber relay by VOC threshold.
// `vocLevel` is raw SGP41 value; convert to ppm-equivalent with /1000.0.
void controlScrubber(float vocLevel)
{
  const float vocPpm = vocLevel / 1000.0;
  if (vocPpm > 30.0)
  {
    if (!scrubberActive)
    {
      setRelay(RELAY_SCRUBBER_PIN, true);
      scrubberActive = true;
      Serial.println("⚠️ VOC > 30.0 ppm. Scrubber ACTIVATED");
    }
  }
  else
  {
    if (scrubberActive)
    {
      setRelay(RELAY_SCRUBBER_PIN, false);
      scrubberActive = false;
      Serial.println("✓ VOC <= 30.0 ppm. Scrubber DEACTIVATED");
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

  // Connect to WiFi hotspot
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);

  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30)
  {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println("✓ WiFi connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println("\n✗ WiFi connection failed!");
    Serial.println("Check hotspot name/password and ensure hotspot is on (2.4GHz)");
  }

  // Initialize relay and MOSFET control pins
  pinMode(RELAY_HUMIDIFIER_PIN, OUTPUT);
  pinMode(RELAY_COLD_FANS_PIN, OUTPUT);
  pinMode(RELAY_PUMP_PIN, OUTPUT);
  pinMode(RELAY_SCRUBBER_PIN, OUTPUT);
  pinMode(PELTIER_MOSFET_PIN, OUTPUT);

  // Start OFF (relay board is active-LOW)
  setRelay(RELAY_HUMIDIFIER_PIN, false);
  setRelay(RELAY_COLD_FANS_PIN, false);
  setRelay(RELAY_PUMP_PIN, false);
  setRelay(RELAY_SCRUBBER_PIN, false);
  digitalWrite(PELTIER_MOSFET_PIN, LOW);

  runActuatorSelfTest();

  Serial.println("\n=== ACTUATOR CONFIGURATION ===");
  Serial.println("4-Channel Relay (active-LOW):");
  Serial.println("  • CH1 GPIO23: Humidifier");
  Serial.println("  • CH2 GPIO19: Cold-side fan group");
  Serial.println("  • CH3 GPIO18: Water pump");
  Serial.println("  • CH4 GPIO17: Scrubber (VOC control)");
  Serial.println("Peltier control via IRLZ44N MOSFET:");
  Serial.println("  • GPIO26: MOSFET gate (PID time-proportioning)");
  Serial.println("==============================\n");

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

    // Control systems
    controlCooling(temperature);
    controlHumidifier(humidity);
    controlScrubber(vocIndex);

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
    Serial.print(" (Demand=");
    Serial.print(coolingDemandPct, 1);
    Serial.print("%)");
    Serial.print(" | PeltierMOSFET=");
    Serial.print(peltierActive ? "ON" : "OFF");
    Serial.print(" | ColdFans=");
    Serial.print(coldFansActive ? "ON" : "OFF");
    Serial.print(" | Pump=");
    Serial.print(pumpActive ? "ON" : "OFF");
    Serial.print(" | Humidifier=");
    Serial.print(humidifierActive ? "ON" : "OFF");
    Serial.print(" | Scrubber=");
    Serial.println(scrubberActive ? "ON" : "OFF");

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
