# Engine A — collar firmware contract

**Audience:** the firmware team. This document is the interface. The cloud
(Engine B) is built to exactly what is written here; anything the collar does
differently will silently degrade the risk model rather than fail loudly.

Firmware itself is out of scope for the software build (§7.1) — this specifies
what it must do. The executable reference for the fall gates lives in
[`src/engine/fall.ts`](../src/engine/fall.ts); port it, don't reinvent it.

---

## Why there are two engines

|  | **Engine A — collar** | **Engine B — cloud** |
|---|---|---|
| Runs on | ESP32, every GPS fix | Edge Function, every packet |
| Latency budget | 200 ms | 2 s |
| Must work when | network is completely dead | always |
| Method | deterministic geometry only | scoring + Monte Carlo + ML |
| Knows about | this animal, right now | 30 days, the whole herd, live traffic |
| Output | buzzer/vibration + 18-byte packet | risk object + alerts |

Engine A exists so the buzzer fires with **zero network involvement**. A cow
walking onto a highway during an outage must still be warned.

---

## Raw IMU never leaves the collar

The IMU samples at 50–100 Hz. The LoRa packet is 18 bytes at a 1 % duty cycle.
You physically cannot transmit accelerometer streams, and you do not need to —
the IMU's job **finishes on the collar**.

Only the *conclusion* travels:

- `movement_state` — 0 still, 1 grazing, 2 walking, 3 running
- `event_code` — 0 heartbeat, 1 motion, 2 geofence, 3 road_approach,
  4 fall, 5 on_road, 6 tamper

Do not add a "raw sample" field. If Engine B ever appears to need one, the
detection logic is in the wrong place.

---

## Stored in flash

- Geofence polygon, **≤ 16 vertices**
- The **10–20 nearest dangerous road segments** (polylines, `base_risk` each)
- Thresholds below

Refreshed opportunistically whenever the collar has a link. The collar must
operate indefinitely on a stale copy — degraded, never dead.

---

## GPS veto — evaluate FIRST, every time

```
if fix_quality < 2 OR hdop > 5 OR sats < 5:
    transmit the packet with the poor-fix values intact
    DO NOT buzz
    DO NOT evaluate geofence or road proximity
```

A bad fix can place an animal 50 m across a road she is nowhere near. A false
buzz in the field costs more farmer trust than a missed one does. The cloud
raises a **device** alert if this persists past 15 minutes — the collar itself
raises nothing.

---

## Local evaluation (deterministic geometry only)

```
distance_to_road  = min perpendicular distance to any stored segment
bearing_to_road   = bearing to the nearest point on that segment
theta             = angular difference(heading, bearing_to_road)   # wrap-safe
closing_speed     = speed_mps * cos(theta)
```

`closing_speed` is the whole point. A cow walking **parallel** to a highway has
`cos(theta) ≈ 0` and must not buzz, however close she is. Without this the
collar buzzes at every animal grazing along a roadside — which is most of them
— and the farmer tapes over the speaker in week one.

### Buzzer rules

| Condition | Buzzer |
|---|---|
| `closing_speed > 0.1 m/s` and `distance_to_road < 100 m` | short pulses |
| `distance_to_road < 30 m` and closing | rapid pulses |
| `distance_to_road < 15 m` (**on road**) | continuous |
| on road **and** still > 60 s | continuous + `event_code = 5` every packet |
| outside geofence buffer | double pulse every 30 s |

The continuous buzzer for a stationary animal on a road matters specifically:
it is the one situation where the noise might actually move her off it.

---

## Fall detection — order is the discriminator

Cattle lie down 8–12 hours a day. "Orientation change then stillness" describes
ruminating exactly as well as it describes a fall. The **impact spike arriving
first** is what separates them.

```
GATE 1 (hard)  peak |a| > 2.5 g within a 200 ms window
               -> 3.5 g between 21:00 and 05:00
               -> if not met, EXIT. No fall, regardless of anything else.
GATE 2         orientation change > 60 deg within 3 s OF the spike
GATE 3         |a - 1g| < 0.15 g sustained 90 s
               -> emit event_code = 4
```

A deliberate lie-down is a slow controlled rotation, typically peaking under
1.5 g. Gate 1 is what makes this usable instead of a nuisance. Do not reorder
the gates and do not soften gate 1 to "catch more falls" — every fall it
catches that way costs a hundred false ones.

---

## Adaptive reporting

| Situation | Interval |
|---|---|
| Idle inside zone | 10 min |
| Moving | 2 min |
| Within 100 m of the zone boundary | 30 s |
| Heading toward a road | 15 s |
| Farmer requested live | 5 s |

**Stagger wake times across collars.** If every collar in a herd reports on the
same boundary, the map is uniformly stale between ticks; staggered, it is never
more than one interval old as a whole without anyone requesting a refresh.

---

## The 18-byte packet

| Field | Bytes | Notes |
|---|---|---|
| `lat` | 4 | int32, degrees × 1e7 |
| `lon` | 4 | int32, degrees × 1e7 |
| `speed_kmh` | 1 | uint8, × 0.5 → 0–127 km/h |
| `heading_deg` | 1 | uint8, × 2 → 0–358° |
| `fix_quality` / `sats` | 1 | 2 bits + 6 bits |
| `hdop` | 1 | uint8, × 0.1 |
| `battery_pct` | 1 | uint8 |
| `movement_state` / `event_code` | 1 | 2 bits + 6 bits |
| `seq` | 2 | uint16, wraps |
| `recorded_at` | 2 | uint16, seconds since last packet |

`seq` is what makes ingest idempotent: the database has a unique index on
`(device_id, seq)`, so a collar retrying over flaky LoRa cannot create a second
position. Increment it on every transmission, including retries of the same
reading — no, on retries **keep the same seq**. That is the point.

---

## Authentication

Every POST carries `x-device-secret`, matching `DEVICE_INGEST_SECRET`. The
server compares in constant time. The device simulator uses the identical
header, which is why the system cannot tell a simulated collar from a real one.

---

# THE DOWNLINK — read this part first

The collar POSTs telemetry. **The response to that POST is the collar's
instruction set.** There is no second connection, no polling, no MQTT. A
battery-powered device should open exactly one socket per wake-up.

```
POST https://bzufqeuaordhrykgsiub.supabase.co/functions/v1/ingest
Content-Type: application/json
x-device-secret: <DEVICE_INGEST_SECRET>

{ "device_id": "SIM-001", "lat": 13.0826, "lon": 77.5932,
  "speed_kmh": 4.1, "heading_deg": 212, "fix_quality": 3, "hdop": 1.2,
  "sats": 9, "battery_pct": 78, "movement_state": 2, "event_code": 0,
  "seq": 8412, "recorded_at": "2026-08-12T11:04:22Z" }
```

### The response

```jsonc
{
  "ok": true,
  "enabled": true,          // false => farmer switched the collar OFF
  "steering": true,         // false => keep tracking, but never cue

  "cue": {                  // WHAT TO PLAY, RIGHT NOW
    "active": true,
    "side": "left",         // left | right | both | null
    "pattern": "tone_fast", // none | tone | tone_fast | tone_vibrate | continuous
    "intensity": 2,         // 0-4, map to volume / motor duty
    "reason": "road",       // road | zone_boundary | outside_zone | null
    "target_bearing": 180   // heading we want her on; for a closed loop
  },

  "commands": [             // queued by the farmer in the app
    { "id": "…", "command": "locate", "payload": { "seconds": 10 } }
  ],

  "next_interval_s": 15     // when to wake next. OBEY THIS.
}
```

### Firmware rules

1. **`enabled: false` means silent.** No cue, no buzzer, nothing — whatever the
   geometry says. This is the farmer walking the herd down a lane to another
   field; the animals will cross boundaries and roads on purpose and the collar
   must not fight them the whole way. Keep reporting position: he still wants
   to see where they are.

2. **Play `cue` exactly as given. Do not re-derive it.** The cloud knows the
   road class, the live traffic, the schedule and the herd. The collar's local
   evaluation (above) is the FALLBACK for when the network is dead, not a
   second opinion to reconcile.

3. **`side` is the transducer to fire, not the direction to send her.** She
   walks AWAY from the sound. The server has already inverted this. Fire the
   side you are told.

4. **Obey `next_interval_s`.** It ranges 5–600 s. This is how the farmer's
   "See live" button works and how the battery survives; it changes without a
   firmware flash.

5. **Ack commands** by echoing the ids on your next POST as
   `"acked": ["id1","id2"]`. Commands expire after 2 minutes server-side — a
   "beep now" that lands ten minutes late just startles the animal.

6. **On any network failure, fall back to local evaluation** (the geofence
   polygon and road segments in flash) and keep going. Never stop cueing
   because the cloud is unreachable.

### Command verbs

| `command` | payload | do |
|---|---|---|
| `set_enabled` | `{enabled}` | master on/off, persist to flash |
| `set_steering` | `{on}` | cue on/off, keep tracking |
| `locate` | `{seconds}` | beep so the farmer can find her |
| `steer` | `{side, seconds, intensity}` | manual cue, for bench-testing |
| `mute` | `{until}` | silence cues until an ISO timestamp |
| `set_interval` | `{seconds, until}` | temporary reporting rate |
| `set_zone` | `{ring, buffer_m}` | replace the flash geofence |

### Cue ladder

| intensity | pattern | when |
|---|---|---|
| 1 | `tone` | drifting toward the edge, or 80–150 m from a highway and closing |
| 2 | `tone_fast` | has not turned; 30–80 m and closing |
| 3 | `tone_vibrate` | under 30 m and closing, or already outside the zone |
| 4 | `continuous` | **on the carriageway** — both sides, noise itself may move her |

No shock at any level. Audio plus vibration is where commercial cattle virtual
fencing lands, and a shocked animal bolts in an unpredictable direction —
which, next to a highway, is the failure you are trying to prevent.

### Two rules the cue obeys that firmware must not undo

- **A cow walking parallel to a highway is never cued**, however close she is.
  Closing speed, not proximity, gates the road cue. Cue her for grazing along a
  roadside — which is most animals, most days — and she learns the collar is
  noise and stops responding when it matters.
- **A cow inside the buffer but walking back into her field is never cued.**
  Punishing the behaviour you want is how a fence stops working.
