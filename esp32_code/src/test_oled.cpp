#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDRESS 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

void setup()
{
  Serial.begin(115200);
  delay(500);
  Wire.begin(21, 22); // SDA=21, SCL=22
  Serial.println("Starting OLED test...");

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS))
  {
    Serial.println("SSD1306 allocation failed");
    while (1)
      delay(1000);
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("OLED Test");
  display.println("If you see this, I2C works");
  display.display();
}

void loop()
{
  // Simple animation to show the display is alive
  for (int x = 0; x < SCREEN_WIDTH; x += 8)
  {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("OLED Test");
    display.fillRect(x, 20, 6, 6, SSD1306_WHITE);
    display.display();
    delay(120);
  }
  delay(500);
}
