/*
 * Cold Storage Unit - ESP32 Monitoring System
 * Real-time Temperature & Humidity Monitoring with Web Dashboard
 *
 * Hardware Required:
 * - ESP32 Development Board
 * - DHT22 Temperature & Humidity Sensor
 * - SGP41 VOC Sensor (I2C)
 * - SSD1306 OLED Display 128x64 (I2C)
 * - 4-Channel Relay Module (5V coil, 10A per channel)
 * - Single-Channel Relay Module (5V coil, 10A)
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
 * Relay Control (active-LOW relay modules):
 * 4-Channel Relay Module:
 * - IN1 (GPIO23): Peltier 1 + cooling fans (air pushed through passive KMnO4 filter)
 * - IN2 (GPIO19): Peltier 2 + pump
 * - IN3 (GPIO18): Humidifier
 * - IN4 (GPIO17): Peltier 3 + radiator fan
 *
 * Single-Channel Relay Module:
 * - IN (GPIO16): Peltier 4
 *
 * Status LEDs (separate indicators):
 * - Green  LED anode -> GPIO25 (through 220-330 ohm resistor), cathode -> GND
 * - Yellow LED anode -> GPIO26 (through 220-330 ohm resistor), cathode -> GND
 * - Red    LED anode -> GPIO27 (through 220-330 ohm resistor), cathode -> GND
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

// Relay control polarity (most relay modules are active-LOW)
#define RELAY_ACTIVE LOW
#define RELAY_INACTIVE HIGH
// NOTE: The single-channel relay on `RELAY_PELTIER4_PIN` is wired as active-HIGH
// (coil powered / LED lights when IN is driven HIGH). We handle that pin
// specially in `setRelay()` so the rest of the code can continue to use
// logical `true` = ON semantics.

// 4-Channel Relay Module - GPIO Assignments
#define RELAY_PELTIER1_PIN 23   // IN1: Peltier 1 + cooling fans (air pushed through passive KMnO4 filter)
#define RELAY_PELTIER2_PIN 19   // IN2: Peltier 2 + pump
#define RELAY_HUMIDIFIER_PIN 18 // IN3: Humidifier
#define RELAY_PELTIER3_PIN 17   // IN4: Peltier 3 + radiator fan

// Single-Channel Relay Module
#define RELAY_PELTIER4_PIN 16 // Peltier 4

// Status LED GPIOs (separate LEDs)
#define LED_GREEN_PIN 25
#define LED_YELLOW_PIN 26
#define LED_RED_PIN 27

// Default control thresholds (will be updated from server)
float VOC_THRESHOLD = 50.0; // VOC threshold in IAQ index
float TEMP_MIN = 9.0;       // Mixed tomato + fallback minimum temperature (°C)
float TEMP_MAX = 11.0;      // Mixed tomato + potato fallback maximum temperature (°C)
float HUMIDITY_MIN = 80.0;  // Target minimum humidity (%)
float HUMIDITY_MAX = 90.0;  // Target maximum humidity (%)

// Proportional control for temperature and humidity
const unsigned long RELAY_PWM_WINDOW_MS = 120000; // 2-minute time-proportioning window
const unsigned long RELAY_MIN_TOGGLE_MS = 20000;  // Minimum 20s between relay state changes

// Last threshold update time
unsigned long lastThresholdUpdate = 0;
const unsigned long THRESHOLD_UPDATE_INTERVAL = 300000; // Update every 5 minutes

// Calibration offsets (adjust based on known reference values)
#define TEMP_OFFSET 0.0 // No calibration - raw DHT22 reading
#define HUM_OFFSET 0.0  // No calibration - raw DHT22 reading

// Create DHT sensor object
DHT dht(DHT_PIN, DHT_TYPE);

// VOC sensor variables
uint16_t vocRaw = 0;

// VOC monitoring (keep readings for scrubber effectiveness checks)
float lastVoc = NAN;
unsigned long lastVocTrendMs = 0;
const unsigned long VOC_TREND_INTERVAL_MS = 300000; // 5 minutes between trend checks
const float VOC_TREND_PCT_THRESHOLD = 5.0f;         // percent change threshold to flag
float lastVocChangePct = 0.0f;
bool scrubberActive = false;

// Variables to store sensor readings
float temperature = 0.0;
float humidity = 0.0;
float vocIndex = 0.0;
int failedReadings = 0;
bool sgpReady = false;

// Relay status tracking
bool coolingActive = false;
bool peltier1Active = false;
bool peltier2Active = false;
bool peltier3Active = false;
bool peltier4Active = false;
bool humidifierActive = false;
float coolingDemandPct = 0.0;

unsigned long relayWindowStartMs = 0;
unsigned long coolingLastToggleMs = 0;

// Humidity hysteresis control with 5-second pulse boost
enum HumidifierState
{
  ABOVE_THRESHOLD, // Humidity >= 80%, relay OFF
  BELOW_THRESHOLD, // Humidity < 80%, relay ON continuously
  PULSE_MODE       // Just transitioned below 80%, relay ON for 5 seconds
};

HumidifierState humidifierState = ABOVE_THRESHOLD;
unsigned long pulseStartMs = 0; // When pulse mode started

// LED blink timer state (used for disconnected/critical blink patterns)
unsigned long ledBlinkLastMs = 0;
bool ledBlinkOn = false;

const bool RUN_ACTUATOR_SELF_TEST = true;
const unsigned long SELF_TEST_ON_MS = 1500;
const unsigned long SELF_TEST_GAP_MS = 500;

// LED self-test and diagnostics removed — normal boot behavior restored

bool relayIsActiveHigh(uint8_t relayPin)
{
  return relayPin == RELAY_PELTIER4_PIN;
}

void setStatusLeds(bool greenOn, bool yellowOn, bool redOn)
{
  digitalWrite(LED_GREEN_PIN, greenOn ? HIGH : LOW);
  digitalWrite(LED_YELLOW_PIN, yellowOn ? HIGH : LOW);
  digitalWrite(LED_RED_PIN, redOn ? HIGH : LOW);
}

void updateStatusLeds(bool sensorReadOk)
{
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  const bool hasVocReading = sgpReady && !isnan(vocIndex);

  // Warning thresholds: outside configured range.
  const bool tempWarn = temperature < TEMP_MIN || temperature > TEMP_MAX;
  const bool humWarn = humidity < HUMIDITY_MIN || humidity > HUMIDITY_MAX;
  const bool vocWarn = hasVocReading && vocIndex > VOC_THRESHOLD;

  // Critical thresholds: significantly outside range.
  const bool tempCritical = temperature < (TEMP_MIN - 2.0f) || temperature > (TEMP_MAX + 2.0f);
  const bool humCritical = humidity < (HUMIDITY_MIN - 8.0f) || humidity > (HUMIDITY_MAX + 8.0f);
  const bool vocCritical = hasVocReading && vocIndex > (VOC_THRESHOLD * 1.5f);

  const unsigned long now = millis();

  // Disconnected state: blink RED quickly (1s ON / 1s OFF).
  if (!wifiConnected)
  {
    if (now - ledBlinkLastMs >= 1000)
    {
      ledBlinkLastMs = now;
      ledBlinkOn = !ledBlinkOn;
    }
    setStatusLeds(false, false, ledBlinkOn);
    return;
  }

  // Sensor failure or critical state: blink RED slowly (15s ON / 15s OFF).
  if (!sensorReadOk || failedReadings >= 3 || tempCritical || humCritical || vocCritical)
  {
    if (now - ledBlinkLastMs >= 15000)
    {
      ledBlinkLastMs = now;
      ledBlinkOn = !ledBlinkOn;
    }
    setStatusLeds(false, false, ledBlinkOn);
    return;
  }

  // Warning state: solid YELLOW.
  if (tempWarn || humWarn || vocWarn)
  {
    setStatusLeds(false, true, false);
    return;
  }

  // Normal state: solid GREEN.
  setStatusLeds(true, false, false);
}

void setRelay(uint8_t relayPin, bool enabled)
{
  if (relayIsActiveHigh(relayPin))
  {
    // For active-HIGH relays we drive HIGH to enable
    digitalWrite(relayPin, enabled ? HIGH : LOW);
  }
  else
  {
    // Default behaviour: most relays are active-LOW
    digitalWrite(relayPin, enabled ? RELAY_ACTIVE : RELAY_INACTIVE);
  }
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

  Serial.println("[1/5] Peltier 1 (+ cooling fans) relay ON");
  setRelay(RELAY_PELTIER1_PIN, true);
  delay(SELF_TEST_ON_MS);
  setRelay(RELAY_PELTIER1_PIN, false);
  delay(SELF_TEST_GAP_MS);

  Serial.println("[2/5] Peltier 2 (+ pump) relay ON");
  setRelay(RELAY_PELTIER2_PIN, true);
  delay(SELF_TEST_ON_MS);
  setRelay(RELAY_PELTIER2_PIN, false);
  delay(SELF_TEST_GAP_MS);

  Serial.println("[3/5] Humidifier relay ON");
  setRelay(RELAY_HUMIDIFIER_PIN, true);
  delay(SELF_TEST_ON_MS);
  setRelay(RELAY_HUMIDIFIER_PIN, false);
  delay(SELF_TEST_GAP_MS);

  Serial.println("[4/5] Peltier 3 (+ radiator fan) relay ON");
  setRelay(RELAY_PELTIER3_PIN, true);
  delay(SELF_TEST_ON_MS);
  setRelay(RELAY_PELTIER3_PIN, false);
  delay(SELF_TEST_GAP_MS);

  Serial.println("[5/5] Peltier 4 relay ON");
  setRelay(RELAY_PELTIER4_PIN, true);
  delay(SELF_TEST_ON_MS);
  setRelay(RELAY_PELTIER4_PIN, false);

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

  if (!isnan(vocIndex))
  {
    display.print(vocIndex, 1);
    display.print(" IAQ");
    if (vocIndex > VOC_THRESHOLD)
    {
      display.print("!");
    }
  }
  else
  {
    display.print("---IAQ");
  }

  // System Status
  display.setCursor(0, 50);
  display.print("Status: ");
  if (peltier1Active)
    display.print("1");
  else
    display.print("-");
  if (peltier2Active)
    display.print("2");
  else
    display.print("-");
  if (peltier3Active)
    display.print("3");
  else
    display.print("-");
  if (peltier4Active)
    display.print("4");
  else
    display.print("-");
  if (scrubberActive)
    display.print("S");
  else
    display.print("-");
  if (humidifierActive)
    display.print("H");
  else
    display.print("-");

  display.display();
}

// Relay-safe midpoint-target cooling control for all 4 Peltiers.
// Peltiers 1, 2, 3 on 4-channel relay; Peltier 4 on single-channel relay.
// - Target is midpoint of TEMP_MIN..TEMP_MAX.
// - No cooling below midpoint deadband.
// - Cooling demand increases linearly up to 100% at TEMP_MAX.
void controlCooling(float temp)
{
  const unsigned long now = millis();

  if (relayWindowStartMs == 0)
  {
    relayWindowStartMs = now;
    coolingLastToggleMs = now;
  }

  // Normalize configured range so control behaves even if min/max are swapped.
  const float tempLow = min(TEMP_MIN, TEMP_MAX);
  const float tempHigh = max(TEMP_MIN, TEMP_MAX);

  const float tempSetpoint = (tempLow + tempHigh) * 0.5f;
  const float COOLING_DEADBAND_C = 0.5f;
  const float coolingStart = tempSetpoint - COOLING_DEADBAND_C;

  if (temp <= tempLow || temp <= coolingStart)
  {
    coolingDemandPct = 0.0f;
  }
  else if (temp >= tempHigh)
  {
    coolingDemandPct = 100.0f;
  }
  else
  {
    const float span = max(0.1f, tempHigh - coolingStart);
    coolingDemandPct = constrain(((temp - coolingStart) / span) * 100.0f, 0.0f, 100.0f);
  }

  // Reset PWM window every 2 minutes.
  if ((now - relayWindowStartMs) >= RELAY_PWM_WINDOW_MS)
  {
    relayWindowStartMs = now;
  }

  const unsigned long relayOnMs = (unsigned long)(RELAY_PWM_WINDOW_MS * (coolingDemandPct / 100.0f));
  const bool shouldCool = (coolingDemandPct > 0.1f) && ((now - relayWindowStartMs) < relayOnMs);

  const bool canToggle = temp >= tempHigh || temp <= tempLow || ((now - coolingLastToggleMs) >= RELAY_MIN_TOGGLE_MS);
  if (shouldCool != coolingActive && canToggle)
  {
    setRelay(RELAY_PELTIER1_PIN, shouldCool);
    setRelay(RELAY_PELTIER2_PIN, shouldCool);
    setRelay(RELAY_PELTIER3_PIN, shouldCool);
    setRelay(RELAY_PELTIER4_PIN, shouldCool);

    peltier1Active = shouldCool;
    peltier2Active = shouldCool;
    peltier3Active = shouldCool;
    peltier4Active = shouldCool;
    scrubberActive = shouldCool; // passive KMnO4 filter is active whenever cooling airflow runs
    coolingActive = shouldCool;
    coolingLastToggleMs = now;

    if (shouldCool)
    {
      Serial.printf("❄️ Temperature %.1f°C → Cooling ON (Demand %.1f%%, Target %.1f°C)\n", temp, coolingDemandPct, tempSetpoint);
      Serial.println("   → Peltier 1 (+ cooling fans) ON");
      Serial.println("   → Peltier 2 (+ pump) ON");
      Serial.println("   → Peltier 3 (+ radiator fan) ON");
      Serial.println("   → Peltier 4 ON");
    }
    else
    {
      Serial.printf("✓ Temperature %.1f°C → Cooling OFF (Demand %.1f%%, Target %.1f°C)\n", temp, coolingDemandPct, tempSetpoint);
      Serial.println("   → Peltier 1 OFF");
      Serial.println("   → Peltier 2 OFF");
      Serial.println("   → Peltier 3 OFF");
      Serial.println("   → Peltier 4 OFF");
    }
  }
}

// Function to control humidifier with hysteresis + pulse boost
// - OFF when humidity >= 83%
// - ON when humidity < 83%
// - Special: 5-second pulse boost when transitioning from >= 83% to < 83%
void controlHumidifier(float hum)
{
  const unsigned long now = millis();

  switch (humidifierState)
  {
  case ABOVE_THRESHOLD:
    // Humidity is at or above 83% - keep OFF
    if (hum < 83.0f)
    {
      // Crossing down from 83% to below: start 5-second pulse
      humidifierState = PULSE_MODE;
      pulseStartMs = now;
      setRelay(RELAY_HUMIDIFIER_PIN, true);
      humidifierActive = true;
      Serial.printf("💧 Humidity %.1f%% → Pulse ON (5-second boost from 83%%)\n", hum);
    }
    break;

  case PULSE_MODE:
    // In 5-second pulse mode
    if ((now - pulseStartMs) >= 5000)
    {
      // Pulse complete - check where humidity is now
      if (hum < 83.0f)
      {
        // Still below threshold - keep running continuously
        humidifierState = BELOW_THRESHOLD;
        setRelay(RELAY_HUMIDIFIER_PIN, true);
        humidifierActive = true;
        Serial.printf("💧 Humidity %.1f%% → Continuous ON (below 83%%)\n", hum);
      }
      else
      {
        // Risen above threshold - turn off
        humidifierState = ABOVE_THRESHOLD;
        setRelay(RELAY_HUMIDIFIER_PIN, false);
        humidifierActive = false;
        Serial.printf("✓ Humidity %.1f%% → OFF (reached 83%%)\n", hum);
      }
    }
    break;

  case BELOW_THRESHOLD:
    // Humidity is below 83% - keep running
    if (hum >= 83.0f)
    {
      // Crossed above 83% - turn off
      humidifierState = ABOVE_THRESHOLD;
      setRelay(RELAY_HUMIDIFIER_PIN, false);
      humidifierActive = false;
      Serial.printf("✓ Humidity %.1f%% → OFF (reached 83%%)\n", hum);
    }
    break;
  }
}

// Monitor VOC trend to infer scrubber/filter effectiveness
void monitorScrubbing(float voc)
{
  if (isnan(voc))
    return;

  const unsigned long now = millis();

  // Initialize timer and baseline
  if (lastVocTrendMs == 0)
  {
    lastVoc = voc;
    lastVocTrendMs = now;
    return;
  }

  if (now - lastVocTrendMs >= VOC_TREND_INTERVAL_MS)
  {
    float change = lastVoc - voc; // positive if VOC decreased
    float pct = (lastVoc > 0.0f) ? ((change / lastVoc) * 100.0f) : 0.0f;
    lastVocChangePct = pct;

    if (pct > VOC_TREND_PCT_THRESHOLD)
    {
      Serial.printf("✓ VOC down %.1f%% over last %lus — scrubber/filter appears effective\n", pct, (now - lastVocTrendMs) / 1000);
    }
    else if (pct < -VOC_TREND_PCT_THRESHOLD)
    {
      Serial.printf("⚠ VOC up %.1f%% over last %lus — check filter airflow or source VOCs\n", -pct, (now - lastVocTrendMs) / 1000);
    }
    else
    {
      Serial.printf("VOC change %.1f%% over last %lus\n", pct, (now - lastVocTrendMs) / 1000);
    }

    // slide window
    lastVoc = voc;
    lastVocTrendMs = now;
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
    doc["vocs"]["value"] = voc;                  // VOC index value (also used for ethylene monitoring)
    doc["vocs"]["trend_pct"] = lastVocChangePct; // percent change over trend window
    doc["scrubber_active"] = scrubberActive;     // passive KMnO4 filter active when cooling airflow runs
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
          float incomingVoc = doc["voc"].as<float>();
          // Backward compatibility: convert old raw-style threshold (e.g. 30000) to IAQ index.
          VOC_THRESHOLD = incomingVoc > 1000.0f ? incomingVoc / 1000.0f : incomingVoc;
        }

        Serial.println("✓ Thresholds updated from server:");
        Serial.printf("  Temperature: %.1f–%.1f°C\n", TEMP_MIN, TEMP_MAX);
        Serial.printf("  Humidity: %.1f–%.1f%%\n", HUMIDITY_MIN, HUMIDITY_MAX);
        Serial.printf("  VOC: %.1f IAQ\n", VOC_THRESHOLD);
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
    // Fetch thresholds from server immediately after connecting so targets
    // reflect the current storage profile (temperature/humidity/VOC)
    Serial.println("Fetching thresholds from server...");
    updateThresholds();
    lastThresholdUpdate = millis();
  }
  else
  {
    Serial.println("\n✗ WiFi connection failed!");
    Serial.println("Check hotspot name/password and ensure hotspot is on (2.4GHz)");
  }

  // Initialize relay control pins
  pinMode(RELAY_PELTIER1_PIN, OUTPUT);
  pinMode(RELAY_PELTIER2_PIN, OUTPUT);
  pinMode(RELAY_HUMIDIFIER_PIN, OUTPUT);
  pinMode(RELAY_PELTIER3_PIN, OUTPUT);
  pinMode(RELAY_PELTIER4_PIN, OUTPUT);

  // Initialize status LEDs
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_YELLOW_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  setStatusLeds(false, false, false);

  // Normal startup: ensure LEDs are off and continue
  setStatusLeds(false, false, false);

  // Start OFF (active-LOW logic)
  setRelay(RELAY_PELTIER1_PIN, false);
  setRelay(RELAY_PELTIER2_PIN, false);
  setRelay(RELAY_HUMIDIFIER_PIN, false);
  setRelay(RELAY_PELTIER3_PIN, false);
  setRelay(RELAY_PELTIER4_PIN, false);

  runActuatorSelfTest();

  Serial.println("\n=== ACTUATOR CONFIGURATION ===");
  Serial.println("4-Channel Relay Layout (active-LOW):");
  Serial.println("  • IN1 GPIO23: Peltier 1 (+ cooling fans)");
  Serial.println("  • IN2 GPIO19: Peltier 2 (+ pump)");
  Serial.println("  • IN3 GPIO18: Humidifier");
  Serial.println("  • IN4 GPIO17: Peltier 3 (+ radiator fan)");
  Serial.println("Single-Channel Relay Layout (active-LOW):");
  Serial.println("  • IN GPIO16: Peltier 4");
  Serial.println("Status LEDs:");
  Serial.println("  • Green GPIO25: Normal");
  Serial.println("  • Yellow GPIO26: Warning");
  Serial.println("  • Red GPIO27: Critical / WiFi disconnected");
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
        // Convert SGP41 raw signal to IAQ-style index value used by UI and relay thresholding.
        vocIndex = (float)vocRaw / 1000.0f;
      }
      else
      {
        Serial.println("⚠ VOC sensor reading failed");
        vocIndex = NAN;
      }
    }

    // Control systems
    controlCooling(temperature);
    controlHumidifier(humidity);
    // Monitor VOC trend to track passive scrubber/filter effectiveness
    monitorScrubbing(vocIndex);

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
      Serial.print("VOC: ");
      Serial.print(vocIndex, 1);
      Serial.print(" IAQ (Threshold: ");
      Serial.print(VOC_THRESHOLD, 1);
      Serial.println(" IAQ)");
    }
    else if (!sgpReady)
    {
      Serial.println("VOC: ⚠ Sensor not detected");
    }

    // Display system status
    Serial.print("Systems: Cooling=");
    Serial.print(coolingActive ? "ON" : "OFF");
    Serial.print(" (Demand=");
    Serial.print(coolingDemandPct, 1);
    Serial.print("%)");
    Serial.print(" | Peltier1=");
    Serial.print(peltier1Active ? "ON" : "OFF");
    Serial.print(" | Peltier2=");
    Serial.print(peltier2Active ? "ON" : "OFF");
    Serial.print(" | Peltier3=");
    Serial.print(peltier3Active ? "ON" : "OFF");
    Serial.print(" | Peltier4=");
    Serial.print(peltier4Active ? "ON" : "OFF");
    Serial.print(" | Scrubber=");
    Serial.print(scrubberActive ? "ON" : "OFF");
    Serial.print(" | Humidifier=");
    Serial.println(humidifierActive ? "ON" : "OFF");

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

    // Update status LEDs after latest control + network update
    updateStatusLeds(true);

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

    // Sensor errors are treated as critical for LED status
    updateStatusLeds(false);
  }

  // Wait before next reading cycle
  delay(10000); // 10 seconds between cycles
}
