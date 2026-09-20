# Herdwise

**A smart cattle collar that can warn a cow before she reaches a road, even when there is no internet connection.**

Cattle getting onto roads and highways is a common problem in many rural areas. It can lead to accidents, injuries to cattle, and losses for farmers.

Most tracking systems mainly send the animal's GPS location to a server. The server then processes the location and sends an alert back. That works when the network is good, but in rural areas the connection may be weak or unavailable.

Herdwise takes a different approach.

The collar itself checks the cow's location and movement, calculates how close she is to a road or the edge of her allowed area, and can activate a buzzer without waiting for the cloud.

The internet is mainly used for things that the collar cannot do on its own, such as updating road information, sending data to the farmer, and running longer-term prediction models.

---

## How the system works

The basic flow is:

```text
GPS + IMU
    ↓
Check location and movement
    ↓
Is the cow inside her field?
    ↓
Distance to boundary / nearest road
    ↓
Calculate road and boundary risk
    ↓
Risk high enough?
    ↓
Buzzer ON
```

At the same time, important information can be sent to the farmer through the communication system.

The current architecture uses one **leader collar** with the 4G connection. Other **follower collars** communicate with the leader using LoRa.

This means every collar does not need its own SIM card.

---

# Current status

This is what has actually been implemented so far.

| Component                         | Current status                                                            |
| --------------------------------- | ------------------------------------------------------------------------- |
| Risk engine (`src/engine/`)       | Working — 75 tests passing                                                |
| Database                          | Working — Supabase + PostGIS                                              |
| Database security / RLS           | Implemented                                                               |
| Edge Functions                    | Deployed                                                                  |
| Leader collar                     | Working on hardware                                                       |
| GPS + IMU                         | Working                                                                   |
| 4G uplink/downlink                | Working                                                                   |
| LoRa communication                | Tested                                                                    |
| Follower collar                   | LoRa link verified                                                        |
| Road data                         | Working with OpenStreetMap                                                |
| Roads within 300 m sent to collar | Working                                                                   |
| Monte Carlo prediction            | Unit tested and connected, but not yet tested end-to-end on real hardware |
| Farmer web app                    | Working                                                                   |
| English / Hindi / Kannada         | Added                                                                     |
| Solar charging                    | Not built yet                                                             |
| Adaptive reporting                | Not built yet                                                             |
| TinyML behaviour recognition      | Future work                                                               |

So there are a few things in the project that are still planned and should not be presented as finished features.

---

# Important things to fix before a public demo

There are also some known issues in the current repository.

* `DEVICE_INGEST_SECRET` was accidentally present in an old git commit (`8c0de27`). The secret should be rotated and the history cleaned before making the repository public.
* The follower firmware is currently configured for **868 MHz**. For India, this needs to be changed to the appropriate licence-free band before doing a field deployment.
* The follower collar currently does not have a watchdog.
* The telemetry cleanup function exists, but it is not scheduled yet.
* Supabase's leaked-password protection is currently disabled.

These are deployment/security issues and not features of the actual risk engine.

---

# Project structure

```text
src/
├── engine/          Risk calculation code
├── screens/         Farmer application screens
└── i18n/            English, Hindi and Kannada translations

supabase/
├── functions/       ingest, roads-fetch, traffic-refresh
└── migrations/      Database tables, RLS and PostGIS functions

firmware/
├── leader_collar/   ESP32-S3 + GPS + IMU + 4G + LoRa
└── follower_collar/ LoRa-only collar

scripts/              Road import, simulation and build scripts
docs/                 Collar documentation and project documents
```

One thing we intentionally did is keep the main risk engine in one place:

```text
src/engine/
```

It does not depend on the browser, Supabase or other external services.

The same code can therefore be used in testing, the web application and Deno Edge Functions.

This avoids having one version of the risk calculation in the app and another version running on the server.

---

# How the collar makes a decision

The collar does not need an internet connection for its basic safety decision.

Every cycle it goes through roughly these steps.

### 1. Check GPS

First, the collar checks whether the GPS fix is usable.

If the GPS data is too old or clearly unrealistic, the collar does not blindly trust it.

This is important because a bad GPS position could make the system think the cow suddenly moved onto a road when she actually did not.

---

### 2. Check the field boundary

The collar checks whether the current position is inside the farmer's defined field.

We use a ray-casting approach for the point-in-polygon check.

---

### 3. Calculate distance

The system calculates the distance from the cow to:

* the field boundary
* nearby roads

Road information comes from OpenStreetMap.

The system only keeps relevant roads around the animal instead of storing every road in the area on the collar.

---

### 4. Check whether she is actually moving towards the road

Distance alone is not enough.

For example, imagine a cow walking parallel to a highway.

She might be only 30 metres away from the highway, but if she is walking along it instead of towards it, immediately triggering an alarm would create unnecessary alerts.

So the system also considers movement direction.

A simplified part of the calculation is:

```text
closing speed = speed × cos(angle)
```

This gives an estimate of whether the animal is actually getting closer to the road.

---

### 5. Calculate risk

The different factors are combined into a risk score between 0 and 100.

The system keeps the individual components as well.

This is useful because if an alert happens, we can see why it happened instead of only seeing:

```text
Risk = 82
```

For example, the system can show that the risk increased because the cow was moving toward a road and the distance had dropped significantly.

---

### 6. Hysteresis

The buzzer does not turn on just because one GPS reading crosses the threshold.

The current logic is:

```text
Risk >= 75 twice → arm alert

Risk < 65 → release
```

This helps prevent the buzzer from constantly switching on and off because of GPS noise.

---

### 7. Buzzer

When the collar decides that the risk is high enough, it activates the buzzer.

The system does **not** use electric shocks.

The idea is to use an audio cue to make the animal change direction.

---

# Prediction in the cloud

The collar handles the immediate decision.

The cloud can do more computationally expensive analysis.

One of the things currently implemented is a Monte Carlo prediction model.

It uses the cow's recent movement behaviour and simulates multiple possible future paths.

For example, the farmer might see:

```text
Estimated chance of reaching road in 5 minutes:
34%
```

The prediction is only displayed when the simulation has actually been run.

It is also important that this prediction does **not** control the collar's emergency decision.

If the internet disappears, the collar can still make its local decision.

---

# Communication architecture

The system currently uses two types of wireless communication.

### LoRa

Follower collars communicate with the leader collar over LoRa.

```text
Follower collar
      ↓
     LoRa
      ↓
Leader collar
```

### 4G

The leader collar has the cellular connection.

```text
Leader collar
      ↓
     4G
      ↓
Supabase
      ↓
Farmer application
```

This reduces the number of SIM cards required when several cattle are being monitored together.

---

# Road data

Road information is imported from OpenStreetMap.

For example:

```bash
npm run import:roads -- --bbox=12.90,77.45,13.10,77.70
```

The bounding box format is:

```text
south, west, north, east
```

We chose OpenStreetMap instead of manually entering roads because manually hardcoding roads would make the system difficult to scale and maintain.

The road data is stored in PostGIS and relevant road segments can be sent to the collar.

---

# Running the project

## Install

```bash
npm install
```

Create the environment file:

```bash
cp .env.example .env
```

The environment file contains things such as:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEVICE_INGEST_SECRET=
TOMTOM_API_KEY=
```

The service-role key and device secret must stay on the server and should never be exposed in the frontend.

The TomTom key is optional. If it is unavailable, the system uses the fallback time-based traffic model.

---

## Start the application

```bash
npm run dev
```

---

## Run the tests

```bash
npm test
```

Current engine test count:

```text
75 tests passing
```

Other useful commands:

```bash
npm run typecheck
npm run build
npm run import:roads
npm run simulate
```

---

# Simulation

The project also has a virtual cattle simulator.

This is useful when testing the system without putting the physical collar outside.

```bash
npm run simulate -- --bootstrap
```

The simulator sends data through the same ingest system used by the real devices.

That makes it possible to test the complete path:

```text
Simulated collar
      ↓
Ingest
      ↓
Supabase
      ↓
Risk / alerts
      ↓
Farmer app
```

---

# Test scenarios

Some of the scenarios currently available are:

| Scenario                | Expected result                                 |
| ----------------------- | ----------------------------------------------- |
| `road-approach`         | Risk increases as the cow approaches a road     |
| `parallel-walk`         | No road alerts                                  |
| `stationary-on-road`    | Critical alert                                  |
| `night-on-road`         | Critical alert + escalation                     |
| `lie-down`              | No fall alert                                   |
| `fall`                  | One fall alert                                  |
| `threshold-oscillation` | One notification because of hysteresis          |
| `bad-gps`               | Device/GPS warning instead of animal warning    |
| `geofence-breach`       | Boundary alert                                  |
| `offline`               | UI shows that the device is no longer reporting |

For example:

```bash
npm run simulate -- --scenario=parallel-walk
```

---

# Firmware

There are two collar firmware projects.

### Leader collar

```text
ESP32-S3
GPS
MPU-6050
Buzzer
4G modem
LoRa
```

The leader handles communication with the cloud and the follower collars.

### Follower collar

The follower is mainly a LoRa device.

It sends its information to the leader instead of requiring its own cellular connection.

The communication packet format and collar behaviour are documented in:

```text
docs/collar-contract.md
```

Raw IMU data is not continuously uploaded to the cloud.

The goal is to process the important information locally and send the resulting state/event instead.

---

# What the farmer sees

The farmer application provides:

* cattle list
* current location
* field boundary
* road-risk alerts
* device status
* alert history
* live map
* location age
* language selection

The application currently supports:

```text
English
हिंदी
ಕನ್ನಡ
```

One rule we follow in the UI is that a stale location should never look like a fresh location.

For example, if the collar has not reported for several minutes, the farmer should be able to see that the location is old.

---

# Some rules we follow in the project

There are a few things we deliberately don't want the interface to hide.

### Don't pretend simulated data is real

If a value comes from the simulator, it should be labelled as simulated.

### Don't show a prediction without running the model

If the Monte Carlo simulation has not run, the probability should remain empty rather than showing a made-up number.

### Show when traffic data is unavailable

If the traffic API stops working, the application should indicate that the fallback model is being used.

### Don't guess when GPS is bad

If the collar does not have a reliable GPS fix, the system should report the GPS problem instead of pretending to know where the cow is.

---

# Technology used

### Collar

* ESP32-S3
* u-blox NEO-6M GPS
* MPU-6050 IMU
* SX1262 LoRa
* Quectel EC200U 4G
* C++ / Arduino
* RadioLib

### Backend

* Supabase
* PostgreSQL
* PostGIS
* Deno Edge Functions
* TypeScript

### Farmer application

* React
* Vite
* Tailwind CSS
* Leaflet
* OpenStreetMap
* i18next
* PWA

### Algorithms

* Ray casting
* Point-to-segment distance
* Haversine distance
* Closing-speed calculation
* Hysteresis
* Monte Carlo simulation
* Douglas–Peucker simplification

---

# What is still planned

Some ideas are intentionally not part of the current prototype.

### Solar charging

The collar is intended to eventually use solar charging, but the current hardware implementation has not been completed.

### Adaptive reporting

The collar could report less frequently when the cow is safe and increase reporting frequency when risk starts increasing.

### TinyML

A future version can use the MPU-6050 data to identify behaviours such as:

* walking
* standing
* grazing
* lying down
* unusual movement

This is not currently presented as a completed feature.

---

# Things we are not building right now

We are keeping the scope limited.

The project currently does not include:

* LoRa mesh visualisation
* chat
* marketplace
* breeding management
* milk tracking
* social feeds
* native Android/iOS application
* gamification
* large admin analytics dashboard

These can be considered later if the core safety system proves useful.

---

# Licence

Private / unlicensed.
