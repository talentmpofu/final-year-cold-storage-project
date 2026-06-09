# Complete Relay Wiring Guide - 4-Channel + Single-Channel Relay Configuration

## Shopping List

### What You Need to Buy:
- ✅ **Already Have:** 1× Single Relay Module (10A)
- 🛒 **Need to Buy:** 1× 4-Channel Relay Module (10A per channel, 5V coil)

**Search for:** "4 Channel Relay Module 5V 10A" (~$5-8 USD)

---

## Complete System Configuration (ALL CHANNELS UNDER 10A ✓)

# Single Relay Module (1 channel)
| GPIO | Device | Current | Function |
|------|--------|---------|----------|
| 16 | **Peltier 4** | 6A | Cooling (single-channel relay) |

### 4-Channel Relay Module
| Channel | GPIO | Device | Current | Function |
|---------|------|--------|---------|----------|
| IN1 | 23 | **Peltier 1 + Cooling Fans** | 8A ✓ | Cooling (air pushed through passive KMnO4 scrubber/filter) |
| IN2 | 19 | **Peltier 2 + Pump** | 8A ✓ | Cooling + pump |
| IN3 | 18 | **Humidifier** | 2A | Humidifier control |
| IN4 | 17 | **Peltier 3 + Radiator Fan** | 6A ✓ | Cooling + radiator fan |

---

## ✅ SAFETY STATUS: ALL CHANNELS SAFE!

**All relay channels should be checked against actual load current.**

- IN1: estimated 8A (Peltier 1 + fans/scrubber) — verify combined current
- IN2: estimated 6–8A (Peltier 2 + pump) — verify combined current
- IN4: estimated 6A (Peltier 3 + radiator fan) — verify combined current
- Single relay IN (GPIO16): estimated 6A (Peltier 4)

---

## Wiring Diagrams

### ESP32 → Relay Modules (Control Side)

**Single Relay Module:**
```
ESP32               Single Relay
-----               ------------
5V      ────────→   VCC
GND     ────────→   GND
GPIO 26 ────────→   IN (Signal)
```

**4-Channel Relay Module:**
```
ESP32               4-CH Relay Module
-----               ------------------
5V      ────────→   VCC
GND     ────────→   GND
GPIO 23 ────────→   IN1 (Peltier 1 + fans + scrubber)
GPIO 19 ────────→   IN2 (Peltier 2 + pump)
GPIO 18 ────────→   IN3 (Humidifier)
GPIO 17 ────────→   IN4 (Peltier 3 + radiator fan)
```

---

### Power Wiring (Load Side)

#### Channel IN1 (GPIO 23): Peltier 1 + Cooling Fans + Scrubber

```
12V PSU (+) ──┬──→ Relay CH1 NO terminal
              │
              └──→ Relay CH1 COM ──┬──→ Peltier 1 (+)
                                   └──→ Water Pump (+)

Peltier 1 (-) ──┬──→ 12V PSU (-)
Water Pump (-) ─┘

Total Current: estimate based on Peltier + fans/scrubber. Verify measured current and choose wire gauge accordingly (16–12 AWG common for high currents).
```

#### Channel IN2 (GPIO 19): Peltier 2 + Pump

```
12V PSU (+) ──┬──→ Relay CH2 NO terminal
              │
              └──→ Relay CH2 COM ──┬──→ Peltier 2 (+)
                                   ├──→ Fan 1 (+)
                                   ├──→ Fan 2 (+)
                                   ├──→ Fan 3 (+)
                                   └──→ Fan 4 (+)

Peltier 2 (-) ──┬──→ 12V PSU (-)
Fans 1-4 (-) ───┘

Total Current: estimate based on Peltier + pump. Verify measured current and choose wire gauge accordingly.
```

#### Channel IN4 (GPIO 17): Peltier 3 + Radiator Fan

```
12V PSU (+) ──┬──→ Relay CH3 NO terminal
              │
              └──→ Relay CH3 COM ──→ Peltier 3 (+)

Peltier 3 (-) ──→ 12V PSU (-)

Total Current: estimate based on Peltier + fan. Verify measured current and choose wire gauge accordingly.
```

#### Single relay (GPIO 16): Peltier 4

```
12V PSU (+) ──┬──→ Relay CH4 NO terminal
              │
              └──→ Relay CH4 COM ──→ Peltier 4 (+)

Peltier 4 (-) ──→ 12V PSU (-)

Total Current: estimate based on Peltier. Verify measured current and choose wire gauge accordingly.
```

#### Notes on humidifier / scrubber wiring

- The humidifier is wired to IN3 (GPIO18) on the 4-channel module.
- The scrubber in this design is a passive Potassium permanganate (KMnO4) filter. It does not require a relay or power; place it in the airflow path so the cold air circulation fans push air through the filter for VOC/ethylene removal. If you instead have an active scrubber that requires power, wire it to its own relay channel and update the firmware to control it.


---

## Control Logic Summary

| Device | Activates When | Deactivates When | GPIO |
|--------|---------------|------------------|------|
| **Cooling System** (All 4 Peltiers + pumps/fans) | Temp > TEMP_MAX | Temp < TEMP_MIN | IN1: GPIO23, IN2: GPIO19, IN4: GPIO17, Single relay: GPIO16 |
| **Humidifier** | Humidity < HUMIDITY_MIN | Humidity > HUMIDITY_MAX | IN3: GPIO18 |

**Note:**
- All Peltiers operate as a unified cooling group in firmware; the scrubber (if wired to IN1) will be powered when that group is active.
- If you need independent VOC-based scrubber control, wire the scrubber to a separate relay channel and modify `esp32_code/src/main.cpp` to enable `controlScrubber()` or equivalent logic.

---

### OLED Display Status Indicators

The OLED status line shows active systems. Current firmware prints `1 2 3 4 H` (numbers indicate Peltiers 1–4, `H` = humidifier) when active.

Example: `1 2 3 4 H` = All Peltiers ON and Humidifier ON

---

## Power Budget

| Component | Voltage | Current | Power | Channel |
|-----------|---------|---------|-------|---------|
| Peltier 1 | 12V | 6A | 72W | CH1 |
| Water Pump | 12V | 2A | 24W | CH1 |
| Peltier 2 | 12V | 6A | 72W | CH2 |
| 4× Fans | 12V | 0.5A | 6W | CH2 |
| Peltier 3 | 12V | 6A | 72W | CH3 |
| Peltier 4 | 12V | 6A | 72W | CH4 |
| Humidifier | 12V | 2A | 24W | Single Relay |
| Scrubber | 12V | 2A | 24W | Single Relay |
| **TOTAL** | **12V** | **~26.5A** | **~366W** | **5 channels** |

**Required PSU:** 12V 30A (360W) - You already have this! ✓

---

## Installation Steps

### 1. Upload Code First
```bash
# In VS Code, use PlatformIO
Upload to ESP32 (select the correct COM port)
```

### 2. Connect ESP32 to Relays (Control Wiring)
- Connect single relay control pins (VCC, GND, GPIO 26)
- Connect 4-channel relay control pins (VCC, GND, GPIO 18/19/23/25)
- **Do NOT connect 12V power yet!**

### 3. Test GPIO Outputs
- Open Serial Monitor
- Watch for relay initialization messages
- Verify all GPIOs initialize to LOW (relays off)

### 4. Connect Load Wiring (12V Power)
- **Turn OFF 12V PSU**
- Wire Peltier 1 + Pump to CH1
- Wire Peltier 2 + Fans to CH2
- Wire Peltier 3 to CH3
- Wire Peltier 4 to CH4
- Wire Humidifier + Scrubber to single relay
- Double-check polarity!

### 5. Power On and Test
- Turn on 12V PSU
- Heat DHT22 sensor (blow hot air) above 4°C
- Verify cooling system activates:
  - All 4 Peltiers get cold
  - Pump flows water through aluminum block
  - Fans spin
- Cool sensor below 2°C, verify all turn off

---

## Troubleshooting

### Relay doesn't click:
- Check 5V supply to relay module
- Verify GPIO pin assignment
- Check relay is active-LOW or active-HIGH (most are active-LOW)

### Peltier modules too hot:
- You wired them backwards! Swap +/- connections
- Or relay is stuck ON - check code

### Water pump not working:
- Check 12V polarity
- Verify relay CH1 clicking
- Prime pump (may need manual start)

### Humidifier OR Scrubber activates when not needed:
- This is normal - they share one relay
- If humidity is low, scrubber also runs
- If VOC is high, humidifier also runs
- This is acceptable since both help air quality

---

## Why This Configuration is Better

✅ **All channels under 10A** - no safety concerns  
✅ **Balanced load distribution** - 6A to 8A per channel  
✅ **Water pump paired with Peltier 1** - ensures heat transfer  
✅ **Fans paired with Peltier 2** - airflow for heat dissipation  
✅ **Humidifier + Scrubber combined** - both improve air quality  
✅ **Standard 16-18 AWG wire works** - no special thick wire needed
```

---

### Power Wiring (Load Side)

#### Channel 1 (GPIO 18): Peltier 1 + 2 in Parallel

```
12V PSU (+) ──┬──→ Relay CH1 NO terminal
              │
              └──→ Relay CH1 COM ──┬──→ Peltier 1 (+)
                                   └──→ Peltier 2 (+)

Peltier 1 (-) ──┬──→ 12V PSU (-)
Peltier 2 (-) ──┘

Total Current: 12A (6A × 2)
Wire: 14-16 AWG
```

#### Channel 2 (GPIO 19): Peltier 3 + 4 in Parallel

```
12V PSU (+) ──┬──→ Relay CH2 NO terminal
              │
              └──→ Relay CH2 COM ──┬──→ Peltier 3 (+)
                                   └──→ Peltier 4 (+)

Peltier 3 (-) ──┬──→ 12V PSU (-)
Peltier 4 (-) ──┘

Total Current: 12A (6A × 2)
Wire: 14-16 AWG
```

#### Channel 3 (GPIO 25): Water Pump + Fans

```
12V PSU (+) ──┬──→ Relay CH3 NO terminal
              │
              └──→ Relay CH3 COM ──┬──→ Water Pump (+)
                                   ├──→ Fan 1 (+)
                                   ├──→ Fan 2 (+)
                                   ├──→ Fan 3 (+)
                                   └──→ Fan 4 (+)

Pump (-) ──┬──→ 12V PSU (-)
Fan 1-4 (-) ──┘

Total Current: 1.5A
Wire: 18-20 AWG OK
```

#### Channel 4 (GPIO 5): Scrubber

```
12V PSU (+) ──┬──→ Relay CH4 NO terminal
              │
              └──→ Relay CH4 COM ──→ Scrubber (+)

Scrubber (-) ──→ 12V PSU (-)

Total Current: 2A
Wire: 18-20 AWG OK
```

#### Single Relay (GPIO 26): Humidifier

```
12V PSU (+) ──┬──→ Single Relay NO terminal
              │
              └──→ Single Relay COM ──→ Humidifier (+)

Humidifier (-) ──→ 12V PSU (-)

Total Current: 2A
Wire: 18-20 AWG OK
```

---

## Control Logic Summary

| Device | Activates When | Deactivates When | GPIO |
|--------|---------------|------------------|------|
| **Cooling System** (Peltiers + Pump + Fans) | Temp > 4°C | Temp < 2°C | 18, 19, 25 |
| **Humidifier** | Humidity < 85% | Humidity > 95% | 26 |
| **Scrubber** | VOC > 30000 | VOC < 30000 | 5 |

**Note:** All 4 Peltiers, water pump, and fans activate/deactivate **together** as one cooling system.

---

## OLED Display Status Indicators

The OLED shows status as: `S C H P`

- **S** = Scrubber active
- **C** = Cooling system active (Peltiers + Pump + Fans)
- **H** = Humidifier active
- **P** = Pump active (same as cooling)

Example: `- C - P` = Cooling system ON, Scrubber and Humidifier OFF

---

## Power Budget

| Component | Voltage | Current | Power | Channels Used |
|-----------|---------|---------|-------|---------------|
| Peltier 1 | 12V | 6A | 72W | CH1 (shared) |
| Peltier 2 | 12V | 6A | 72W | CH1 (shared) |
| Peltier 3 | 12V | 6A | 72W | CH2 (shared) |
| Peltier 4 | 12V | 6A | 72W | CH2 (shared) |
| Water Pump | 12V | 1-3A | 12-36W | CH3 |
| 4× Fans | 12V | 0.5A | 6W | CH3 |
| Humidifier | 12V | 2A | 24W | Single Relay |
| Scrubber | 12V | 2A | 24W | CH4 |
| **TOTAL** | **12V** | **~25.5A** | **~390W** | **5 channels** |

**Required PSU:** 12V 30A (360W) - You already have this! ✓

---

## Installation Steps

### 1. Upload Code First
```bash
# In VS Code, use PlatformIO
Upload to ESP32 (COM3 or COM4)
```

### 2. Connect ESP32 to Relays (Control Wiring)
- Connect single relay control pins (VCC, GND, GPIO 26)
- Connect 4-channel relay control pins (VCC, GND, GPIO 18/19/25/5)
- **Do NOT connect 12V power yet!**

### 3. Test GPIO Outputs
- Open Serial Monitor
- Watch for relay initialization messages
- Verify all GPIOs initialize to LOW (relays off)

### 4. Connect Load Wiring (12V Power)
- **Turn OFF 12V PSU**
- Wire Peltier modules to CH1 & CH2 (use thick wire!)
- Wire pump + fans to CH3
- Wire scrubber to CH4
- Wire humidifier to single relay
- Double-check polarity!

### 5. Power On and Test
- Turn on 12V PSU
- Heat DHT22 sensor (blow hot air) above 4°C
- Verify cooling system activates:
  - Peltiers get cold
  - Pump flows water through aluminum block
  - Fans spin
- Cool sensor below 2°C, verify all turn off

---

## Troubleshooting

### Relay doesn't click:
- Check 5V supply to relay module
- Verify GPIO pin assignment
- Check relay is active-LOW or active-HIGH (most are active-LOW)

### Peltier modules too hot:
- You wired them backwards! Swap +/- connections
- Or relay is stuck ON - check code

### Relay gets very hot (CH1 or CH2):
- This is expected with 12A load
- Add heatsink or upgrade to automotive relay
- Check wire gauge (must be 14-16 AWG)

### Water pump not working:
- Check 12V polarity
- Verify relay CH3 clicking
- Prime pump (may need manual start)

---

## Alternative: Safer 8-Channel Configuration

If you're uncomfortable with 12A relays, consider buying **2× 4-channel relays** instead:

**Module 1 (4 channels):**
- CH1: Peltier 1 (6A) ✓
- CH2: Peltier 2 (6A) ✓
- CH3: Peltier 3 (6A) ✓
- CH4: Peltier 4 (6A) ✓

**Module 2 (4 channels):**
- CH1: Water Pump (2A) ✓
- CH2: All Fans (0.5A) ✓
- CH3: Humidifier (2A) ✓
- CH4: Scrubber (2A) ✓

This keeps ALL channels under 10A but requires 8 GPIOs and costs $10-16 total.

**Let me know if you want me to update the code for this safer 8-channel option!**
