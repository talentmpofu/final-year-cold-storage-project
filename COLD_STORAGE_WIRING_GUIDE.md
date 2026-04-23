# Full Cold-Storage Wiring Guide (ESP32 + DHT22 + SGP41 + OLED + Relay + Peltier MOSFET)

This guide matches the current firmware behavior and pin mapping in `esp32_code/src/main.cpp`.

## 1) Final Control Logic (as requested)

1. Scrubber relay turns ON when VOC is greater than 30.0 ppm and OFF when VOC is 30.0 ppm or below.
2. Peltier MOSFET is driven by PID-style time-proportioning around the temperature setpoint.
3. Cold-side fans relay (IN2) and pump relay (IN3) are supervised by cooling demand with relay-safe minimum ON/OFF timing.
4. A hard floor is applied: if temperature is at or below TEMP_MIN, cooling demand is forced to zero.
5. Humidifier relay turns ON when humidity is below threshold and OFF when humidity is above threshold.

## 2) Final Pin Map

- DHT22 DATA: GPIO4
- I2C SDA (SGP41 + OLED): GPIO21
- I2C SCL (SGP41 + OLED): GPIO22

Relay inputs (active-LOW board):
- IN1 -> GPIO23 (Humidifier)
- IN2 -> GPIO19 (Cold-side fans)
- IN3 -> GPIO18 (Water pump)
- IN4 -> GPIO17 (Scrubber)

Peltier control:
- IRLZ44N Gate -> GPIO26 (through 100 ohm resistor)

## 3) Quick Bench Pinout Table

| Function | Device Pin | Connects To | Notes |
|---|---|---|---|
| DHT22 power | DHT22 VCC | ESP32 3.3V | Add 10k pull-up on DATA to 3.3V |
| DHT22 ground | DHT22 GND | ESP32 GND | Common ground required |
| DHT22 data | DHT22 DATA | ESP32 GPIO4 | Temperature + humidity input |
| I2C SDA | SGP41 SDA + OLED SDA | ESP32 GPIO21 | Shared I2C bus |
| I2C SCL | SGP41 SCL + OLED SCL | ESP32 GPIO22 | Shared I2C bus |
| SGP41 power | SGP41 VCC/GND | ESP32 3.3V / GND | I2C address 0x59 |
| OLED power | OLED VCC/GND | ESP32 3.3V / GND | I2C address usually 0x3C |
| Relay logic power | Relay VCC/GND | 5V / ESP32 GND | Active-LOW board |
| Relay IN1 | Relay IN1 | ESP32 GPIO23 | Humidifier control |
| Relay IN2 | Relay IN2 | ESP32 GPIO19 | Cold-side fan control |
| Relay IN3 | Relay IN3 | ESP32 GPIO18 | Water pump control |
| Relay IN4 | Relay IN4 | ESP32 GPIO17 | Scrubber control |
| Humidifier power path | PSU+ -> COM1 -> NO1 -> Humidifier+ | Humidifier- -> PSU- | Use COM+NO |
| Scrubber power path | PSU+ -> COM4 -> NO4 -> Scrubber+ | Scrubber- -> PSU- | Use COM+NO |
| Peltier MOSFET gate | IRLZ44N Gate | ESP32 GPIO26 via 100 ohm | 10k Gate-to-Source pulldown |
| Peltier MOSFET source | IRLZ44N Source | PSU negative rail | Common ground node |
| Peltier MOSFET drain | IRLZ44N Drain | Combined Peltier negative | Low-side switching |
| Peltier positive | Both TEC1-12706 + | PSU +12V | Not through relay |
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

Connections:
- Relay VCC -> 5V
- Relay GND -> ESP32 GND
- IN1 -> GPIO23
- IN2 -> GPIO19
- IN3 -> GPIO18
- IN4 -> GPIO17

Notes:
- Keep JD-VCC jumper installed for simple mode.
- This board is active-LOW in current firmware (`LOW = ON`, `HIGH = OFF`).

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

### CH2 (Cold-side fans)
- PSU +12V -> COM2
- NO2 -> cold-side fan group +
- cold-side fan group - -> PSU -

### CH3 (Water pump)
- PSU +12V -> COM3
- NO3 -> pump +
- pump - -> PSU -

## 7) IRLZ44N Wiring for Peltiers

TO-220 orientation (front text facing you, legs down):
- Left pin: Gate
- Middle pin: Drain
- Right pin: Source

Connections:
- Source -> PSU negative rail
- Drain -> Combined negative of both Peltier modules
- Positive of both Peltiers -> PSU +12V
- GPIO26 -> 100 ohm -> Gate
- 10k resistor from Gate to Source

Notes:
- Use a heatsink + thermal paste.
- Keep current paths short and thick.
- Peltiers are resistive loads; no flyback diode needed across Peltiers.

## 8) Grounding (critical)

All grounds must be common:
- 12V PSU negative
- ESP32 GND
- Relay board GND
- MOSFET source reference ground

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
2. IN2 relay (cold-side fan channel)
3. IN3 relay (water pump channel)
4. Scrubber relay
5. Peltier MOSFET

Default timings:
- ON time per step: 1500 ms
- Gap between steps: 500 ms

Set `RUN_ACTUATOR_SELF_TEST = false` in code to skip startup test.

## 11) Functional Behavior Summary

Temperature control:
- Setpoint is midpoint of TEMP_MIN and TEMP_MAX.
- PID-style output is converted to a 20-second time window for MOSFET ON/OFF duty.
- If temperature <= TEMP_MIN: MOSFET duty forced to 0% (cooling floor protection).
- If cooling demand >= 20%: IN2 and IN3 relays are requested ON.
- If cooling demand <= 5%: IN2 and IN3 relays are requested OFF.
- IN2 and IN3 relay state changes are delayed by minimum dwell timers (60s ON and 60s OFF) to avoid relay chatter.

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
6. Connect Peltiers last and monitor MOSFET temperature.
7. Re-tighten terminals after first thermal cycle.

---

If you change pin assignments or control rules later, update this file and `esp32_code/src/main.cpp` together.
