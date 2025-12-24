/*
 * Cold Storage Unit - ESP32 Monitoring System
 * Real-time Temperature & Humidity Monitoring with Web Dashboard
 *
 * Hardware Required:
 * - ESP32 Development Board
 * - DHT22 Temperature & Humidity Sensor
 * - SGP41 VOC Sensor (I2C)
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
 * Scrubbing System Relay:
 * - Control Pin -> GPIO 5 (ESP32)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <Wire.h>

// SGP41 I2C Address
#define SGP41_ADDRESS 0x59

// WiFi credentials - UPDATE THESE WITH YOUR NETWORK

const char *ssid = "Talent";
const char *password = "talent401";

// Backend API endpoint - UPDATE THIS WITH YOUR SERVER IP
const char *serverUrl = "http://172.20.10.2:3000/api/metrics";

// Pin definitions
#define DHT_PIN 4      // GPIO 4 for DHT22 data pin
#define DHT_TYPE DHT22 // DHT22 sensor type
#define NUM_READINGS 3 // Number of readings to average
#define SCRUBBER_PIN 5 // GPIO 5 for scrubbing system relay

// VOC threshold in ppm (raw index value for SGP40)
#define VOC_THRESHOLD 150.0 // Threshold to activate scrubbing system

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
bool scrubberActive = false;

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
  // SGP41 measure raw command: 0x260F
  Wire.beginTransmission(SGP41_ADDRESS);
  Wire.write(0x26);
  Wire.write(0x0F);
  Wire.endTransmission();

  delay(50); // Wait for measurement

  // Read 6 bytes (2 bytes data + 1 byte CRC, twice)
  Wire.requestFrom(SGP41_ADDRESS, 6);

  if (Wire.available() >= 6)
  {
    uint8_t voc_msb = Wire.read();
    uint8_t voc_lsb = Wire.read();
    Wire.read(); // CRC
    Wire.read(); // NOx MSB
    Wire.read(); // NOx LSB
    Wire.read(); // CRC

    return (voc_msb << 8) | voc_lsb;
  }

  return 0;
}

// Function to control scrubbing system
void controlScrubber(float vocLevel)
{
  if (vocLevel > VOC_THRESHOLD)
  {
    if (!scrubberActive)
    {
      digitalWrite(SCRUBBER_PIN, HIGH);
      scrubberActive = true;
      Serial.println("⚠ VOC LEVEL HIGH! Scrubbing system ACTIVATED");
    }
  }
  else
  {
    // Add hysteresis: turn off only when significantly below threshold
    if (scrubberActive && vocLevel < (VOC_THRESHOLD * 0.8))
    {
      digitalWrite(SCRUBBER_PIN, LOW);
      scrubberActive = false;
      Serial.println("✓ VOC level normal. Scrubbing system DEACTIVATED");
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
    doc["ethylene"]["value"] = voc / 1000.0; // Convert VOC index to ppm equivalent
    doc["vocs"]["value"] = voc;              // Raw VOC index value
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

  // Initialize scrubber relay pin
  pinMode(SCRUBBER_PIN, OUTPUT);
  digitalWrite(SCRUBBER_PIN, LOW); // Start with scrubber off
  Serial.println("Scrubbing system relay initialized");

  // Initialize I2C for SGP41
  Wire.begin();
  Serial.println("I2C bus initialized");

  // Try to detect SGP41 sensor
  Wire.beginTransmission(SGP41_ADDRESS);
  uint8_t error = Wire.endTransmission();

  if (error == 0)
  {
    Serial.println("✓ SGP41 VOC sensor detected");
    sgpReady = true;
  }
  else
  {
    Serial.println("✗ SGP41 sensor not found!");
    Serial.println("Check I2C wiring (SDA=GPIO21, SCL=GPIO22)");
    sgpReady = false;
  }

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
  // Get averaged readings
  if (getAveragedReadings(temperature, humidity))
  {
    // Read VOC sensor if available
    if (sgpReady)
    {
      vocRaw = readSGP41_VOC();

      if (vocRaw > 0)
      {
        // Convert raw value to index (simplified, typical range 100-500)
        vocIndex = (float)vocRaw / 10.0;

        // Control scrubbing system based on VOC level
        controlScrubber(vocIndex);
      }
      else
      {
        Serial.println("⚠ VOC sensor reading failed");
      }
    }

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
      Serial.print("Scrubber: ");
      Serial.println(scrubberActive ? "ON" : "OFF");
    }

    // Check if temperature is in target range (2-4°C)
    if (temperature >= 2.0 && temperature <= 4.0)
    {
      Serial.println("Status: ✓ Temperature ON TARGET");
    }
    else if (temperature < 2.0)
    {
      Serial.println("Status: ⚠ Temperature BELOW TARGET");
    }
    else
    {
      Serial.println("Status: ⚠ Temperature ABOVE TARGET");
    }

    // Send data to web dashboard
    sendDataToServer(temperature, humidity, sgpReady ? vocIndex : 0.0);

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
  }

  // Wait before next reading cycle
  delay(10000); // 10 seconds between cycles
}
