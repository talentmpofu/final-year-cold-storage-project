#include <Arduino.h>
#include <WiFi.h>

static const char *WIFI_SSID = "Talent";
static const char *WIFI_PASSWORD = "talent401";

void setup()
{
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("=== WiFi test starting ===");

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  delay(500);

  Serial.println("Scanning networks...");
  int networkCount = WiFi.scanNetworks();
  Serial.printf("Found %d networks\n", networkCount);

  for (int index = 0; index < networkCount; index++)
  {
    Serial.printf("%2d: %s (%d dBm)%s\n", index + 1, WiFi.SSID(index).c_str(), WiFi.RSSI(index),
                  WiFi.SSID(index) == WIFI_SSID ? "  <-- target" : "");
  }

  Serial.printf("\nConnecting to %s...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40)
  {
    delay(500);
    Serial.print('.');
    attempts++;
  }
  Serial.println();

  wl_status_t status = WiFi.status();
  Serial.printf("WiFi.status() = %d\n", static_cast<int>(status));

  if (status == WL_CONNECTED)
  {
    Serial.println("Connected successfully");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("RSSI: ");
    Serial.println(WiFi.RSSI());
  }
  else
  {
    Serial.println("Connection failed");
    Serial.println("Check hotspot name, password, 2.4 GHz band, and whether the hotspot allows new devices.");
  }
}

void loop()
{
  delay(1000);
}
