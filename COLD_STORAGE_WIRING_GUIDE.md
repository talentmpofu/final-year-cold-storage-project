# Cold-Storage Wiring Guide (ESP32 + DHT22 + SGP41 + OLED + Relays)

This guide matches the current firmware behavior and pin mapping in `esp32_code/src/main.cpp`.

## 1) Final Control Logic (current firmware)

1. The scrubbing system is powered together with Peltier 1 (co-located on IN1). There is no independent VOC-driven scrubber relay in the firmware — the scrubber runs when the cooling group is active.
2. All four Peltier modules are controlled as a single cooling group: Peltiers 1, 2, 3 (on the 4-channel module) and Peltier 4 (on the single relay).
3. Cooling group is forced ON above `TEMP_MAX` and forced OFF below `TEMP_MIN`.
4. When temperature is in-range, the PID-like controller maps demand to a long time-proportioning relay window to avoid frequent toggles.
5. Humidifier relay is controlled independently by humidity thresholds (`HUMIDITY_MIN` / `HUMIDITY_MAX`).

## 2) Final Pin Map

- DHT22 DATA: GPIO4
- I2C SDA (SGP41 + OLED): GPIO21
- I2C SCL (SGP41 + OLED): GPIO22

Relay inputs (firmware uses active-LOW logic):

- IN1 -> GPIO23 : Peltier 1 + cooling fans (air pushed through passive KMnO4 scrubber/filter)
- IN2 -> GPIO19 : Peltier 2 + pump
- IN3 -> GPIO18 : Humidifier
- IN4 -> GPIO17 : Peltier 3 + radiator fan
- Single-channel relay IN -> GPIO16 : Peltier 4

## 3) Quick Bench Pinout Table

| Function | Device Pin | Connects To | Notes |
| --- | --- | --- | --- |
| DHT22 power | DHT22 VCC | ESP32 3.3V | Add 10k pull-up on DATA to 3.3V |
| DHT22 ground | DHT22 GND | ESP32 GND | Common ground required |
| DHT22 data | DHT22 DATA | ESP32 GPIO4 | Temperature + humidity input |
| I2C SDA | SGP41 SDA + OLED SDA | ESP32 GPIO21 | Shared I2C bus |
| I2C SCL | SGP41 SCL + OLED SCL | ESP32 GPIO22 | Shared I2C bus |
| SGP41 power | SGP41 VCC/GND | ESP32 3.3V / GND | I2C address 0x59 |
| OLED power | OLED VCC/GND | ESP32 3.3V / GND | I2C address usually 0x3C |
| Relay logic power | Relay VCC/GND | 5V / ESP32 GND | Relay board VCC = 5V, common ground required |
| Relay IN1 | Relay IN1 | ESP32 GPIO23 | Peltier 1 + fans + scrubber (powered together when cooling ON) |
| Relay IN2 | Relay IN2 | ESP32 GPIO19 | Peltier 2 + pump |
| Relay IN3 | Relay IN3 | ESP32 GPIO18 | Humidifier |
| Relay IN4 | Relay IN4 | ESP32 GPIO17 | Peltier 3 + radiator fan |
| Single relay IN | Single relay IN | ESP32 GPIO16 | Peltier 4 (single-channel relay) |
| Peltier 1 power path | PSU+ -> COM1 -> NO1 -> Peltier1+ | Peltier1- -> PSU- | Use COM & NO for normal-OFF behavior |
| Peltier 2 power path | PSU+ -> COM2 -> NO2 -> Peltier2+ | Peltier2- -> PSU- | Dedicated relay channel |
| Peltier 3 power path | PSU+ -> COM3 -> NO3 -> Peltier3+ | Peltier3- -> PSU- | Dedicated relay channel |
| Peltier 4 power path | PSU+ -> COM4 -> NO4 -> Peltier4+ | Peltier4- -> PSU- | Single-channel relay contact |
| Humidifier power path | PSU+ -> COMx -> NOx -> Humidifier+ | Humidifier- -> PSU- | Use COM & NO |
| Scrubber | Passive KMnO4 filter placed in the airflow path; no relay or power required. The cold air circulation fans push air through the filter to perform VOC/ethylene removal. |
| System ground | PSU-, ESP32 GND, Relay GND | Commoned together | Mandatory |

## 4) Low-Voltage Wiring (ESP32, Sensors, Display)

### 4.1 ESP32 Power

- Power ESP32 from USB (development) or stable 5V.
- Keep ESP32 GND tied to system common ground.

### 4.2 DHT22 Wiring

- DHT22 VCC -> ESP32 3.3V
- DHT22 GND -> ESP32 GND
- DHT22 DATA -> ESP32 GPIO4
- 10k resistor between DHT22 DATA and 3.3V

### 4.3 Shared I2C (SGP41 + OLED)

- ESP32 GPIO21 -> SGP41 SDA and OLED SDA
- ESP32 GPIO22 -> SGP41 SCL and OLED SCL
- ESP32 3.3V -> SGP41 VCC and OLED VCC
- ESP32 GND -> SGP41 GND and OLED GND

## 5) Relay Module Wiring (control header)

Relay header:

- GND IN1 IN2 IN3 IN4 VCC

Extra single-channel relay:

- IN, VCC, GND

Connections:

- Relay VCC -> 5V
- Relay GND -> ESP32 GND
- IN1 -> GPIO23
- IN2 -> GPIO19
- IN3 -> GPIO18
- IN4 -> GPIO17
- Extra relay IN -> GPIO16

Notes:

- Keep JD-VCC jumper installed for simple mode.
- Firmware is configured for active-LOW relay control (`LOW = ON`, `HIGH = OFF`).

## 6) 12V Load Wiring (relay contact side)

Use COM and NO for normal OFF behavior.

### CH1 (Humidifier)

- PSU +12V -> COM1
- NO1 -> Humidifier +
- Humidifier - -> PSU -

### CH4 (Scrubber)

- PSU +12V -> COM4
- NO4 -> Scrubber +
- Scrubber - -> PSU -

### CH2 (Peltier Module 1)

- PSU +12V -> COM2
- NO2 -> Peltier 1 +
- Peltier 1 - -> PSU -

### CH3 (Peltier Module 2)

- PSU +12V -> COM3
- NO3 -> Peltier 2 +
- Peltier 2 - -> PSU -

### CH5 (Auxiliary cooling, extra relay on GPIO16)

- PSU +12V -> COM5
- NO5 -> Fan/Pump +
- Fan/Pump - -> PSU -

## 8) Grounding (critical)

All grounds must be common:

- 12V PSU negative
- ESP32 GND
- Relay board GND
- Extra relay GND

## 9) Protection and Good Practice

Recommended:

- Main fuse on 12V output
- Branch fuse for humidifier and scrubber lines
- Correct wire gauge for actuator currents
- Keep control wires away from high-current wiring
- Tighten terminal screws and add strain relief

## 10) Startup Self-Test (current firmware)

On boot, firmware pulses outputs briefly in sequence:

1. Humidifier relay
2. Peltier 1 relay
3. Peltier 2 relay
4. Auxiliary cooling relay (GPIO16)
5. Scrubber relay

Default timings:

- ON time per step: 1500 ms
- Gap between steps: 500 ms

Set `RUN_ACTUATOR_SELF_TEST = false` in code to skip startup test.

## 11) Functional Behavior Summary

Temperature control:

- Setpoint is midpoint of TEMP_MIN and TEMP_MAX.
- PID-like demand is converted to a 2-minute relay time-proportioning window.
- If temperature > TEMP_MAX: cooling relays are forced ON.
- If temperature < TEMP_MIN: cooling relays are forced OFF.
- In range, duty follows PID demand with a minimum 20-second relay toggle interval to reduce chatter.

Humidity control:

- If humidity < HUMIDITY_MIN: Humidifier relay ON
- If humidity > HUMIDITY_MAX: Humidifier relay OFF

VOC control:

- If VOC > 30.0 ppm: Scrubber relay ON
- If VOC <= 30.0 ppm: Scrubber relay OFF

## 12) Safe Commissioning Checklist

1. Verify all wiring with power OFF.
2. Power ESP32 and relay logic first (no 12V loads connected).
3. Confirm relay LEDs and startup self-test sequence.
4. Connect humidifier and verify humidity trigger.
5. Connect scrubber and verify VOC trigger.
6. Connect Peltiers last and verify relay channels switch cleanly under load.
7. Re-tighten terminals after first thermal cycle.

---

If you change pin assignments or control rules later, update this file and `esp32_code/src/main.cpp` together.
