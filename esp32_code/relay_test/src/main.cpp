#include <Arduino.h>

#define RELAY_PIN 16

void setup()
{
  Serial.begin(115200);
  delay(1000);
  Serial.println("Relay test: toggling GPIO16 (active LOW)");
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // start OFF (active LOW)
}

void loop()
{
  Serial.println("Turning relay ON (LOW)");
  digitalWrite(RELAY_PIN, LOW);
  delay(2000);
  Serial.println("Turning relay OFF (HIGH)");
  digitalWrite(RELAY_PIN, HIGH);
  delay(2000);
}
