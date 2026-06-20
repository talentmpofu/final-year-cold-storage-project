#include <Arduino.h>
#include <Wire.h>

void setup()
{
  Serial.begin(115200);
  delay(500);
  // Initialize I2C on default ESP32 pins: SDA=21, SCL=22
  Wire.begin(21, 22);
  Serial.println("I2C scanner starting...");
}

void loop()
{
  byte error, address;
  int nDevices = 0;

  Serial.println("Scanning I2C bus...");
  for (address = 1; address < 127; address++)
  {
    Wire.beginTransmission(address);
    error = Wire.endTransmission();

    if (error == 0)
    {
      Serial.print("I2C device found at 0x");
      if (address < 16)
        Serial.print("0");
      Serial.print(address, HEX);
      Serial.println("  !");
      nDevices++;
    }
    else if (error == 4)
    {
      Serial.print("Unknown error at 0x");
      if (address < 16)
        Serial.print("0");
      Serial.println(address, HEX);
    }
  }

  if (nDevices == 0)
    Serial.println("No I2C devices found\n");
  else
    Serial.println("Scan complete\n");

  delay(3000);
}
