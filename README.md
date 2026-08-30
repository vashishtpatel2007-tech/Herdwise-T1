# PashuGuard

Real-time cattle safety for smallholder farmers in rural India. Shows where the
animals are, warns the farmer **before** an animal reaches a dangerous road,
detects falls, and gives any bystander who finds a lost animal a way to reach
the owner by scanning a tag.

Built for a farmer standing in a field in direct sunlight, possibly with limited
literacy, on a cheap Android phone with one bar of signal. Every decision in
here follows from that sentence.

---

## Status

| Piece | State |
|---|---|
| Database (11 tables, PostGIS, RLS) | **Live** — project `bzufqeuaordhrykgsiub`, ap-south-1 |
| Risk engine (§7) | **Live**, 37 tests passing (24 acceptance + 13 regression) |
| Edge Functions `ingest`, `traffic-refresh` | **Deployed** |
| Frontend (10 screens, 3 languages, PWA) | **Builds clean**, typechecks clean |
| Road data | **Not imported yet** — needs the service-role key |
| Simulator run | **Not run yet** — needs the device secret |

The app has never been seen rendering live data. It compiles and its engine is
tested; that is a different and weaker claim, and it is the honest one.

### Audit

An adversarial audit found seven real defects that shipped while the original
24 tests were green. All are fixed, each with a regression test:

| Defect | Why the tests missed it |
|---|---|
| Monte Carlo never ran — PostgREST returns geography as hex EWKB, not `POINT(x y)`, so the ingest regex never matched and `recent_fixes` was always empty | tests feed the engine fixtures directly, never crossing the DB boundary |
| `stationary_since` was computed then discarded, so the 60 s clock reset every packet and `stationary_on_road` could never latch | the test hand-built the timestamp that production never wrote |
| Night escalation to authority was unreachable — `on_road` already pins state to `critical`, so the later transition was flat | the test started from `safe`, a state no real packet sequence produces |
| The 180 s cooldown was dead code — its guard was textually identical to a condition already known true | the test asserted only that escalation got through, which it did |
| Every time-of-day decision used the host clock; the Edge runtime is UTC, so 02:00 IST read as daytime | tests ran on a machine already in IST |
| `ON CONFLICT` cannot infer a partial unique index, so every ingest upsert would have failed | never exercised without a database |
| The phone mask failed **open**, emitting the raw number whenever the pattern did not match | no test fed it a non-matching format |

The lesson is in the right-hand column: a pure, fast, fixture-driven test suite
proved the engine correct and proved nothing about the system. The regression
tests in `src/engine/__tests__/regressions.test.ts` target that seam.

---

## Setup

### 1. Fill in `.env`

Three values are missing. Put them in `.env` (already gitignored) — never in a
chat window, never in a commit.

```
SUPABASE_SERVICE_ROLE_KEY=    # Dashboard -> Project Settings -> API -> service_role
DEVICE_INGEST_SECRET=         # openssl rand -hex 32
TOMTOM_API_KEY=               # https://developer.tomtom.com — OPTIONAL
```

`TOMTOM_API_KEY` is genuinely optional: without it the engine runs the
time-of-day traffic model and the UI says so (§13.4). That path is tested.

### 2. Set the same secrets on the Edge Functions

Dashboard → Edge Functions → Secrets. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically; you only need to add:

```
DEVICE_INGEST_SECRET=<the same value as .env>
TOMTOM_API_KEY=<optional>
```

### 3. Import real roads

```bash
npm run import:roads -- --bbox=12.90,77.45,13.10,77.70
```

bbox is `south,west,north,east`. This queries OpenStreetMap via Overpass and is
the **only** source of road data in the system — no road is hardcoded anywhere,
because inventing a road would invent a danger.

### 4. Create the demo herd and start the collars

```bash
npm run simulate -- --bootstrap
```

12 virtual collars begin reporting to the real ingest endpoint with the real
device secret. The system cannot tell them from hardware.

### 5. Run the app

```bash
npm run dev
```

---

## The scenarios are the test suite and the demo script

```bash
npm run simulate -- --scenario=parallel-walk
```

| Scenario | Must produce |
|---|---|
| `road-approach` | escalating alerts as she closes |
| `parallel-walk` | **zero** alerts over 30 min — proves §7.3 |
| `stationary-on-road` | critical within one reporting interval — proves §7.4 |
| `night-on-road` | critical + voice call + authority escalation |
| `lie-down` | **zero** fall alerts — proves §7.8 |
| `fall` | exactly one |
| `threshold-oscillation` | exactly **one** notification — proves §7.9 |
| `bad-gps` | a **device** alert, never an animal alert — proves §7.2 |
| `geofence-breach` | zone alert |
| `offline` | collar goes quiet, UI shows the age |

The engine half of these is asserted in code:

```bash
npm test
```

---

## Architecture

```
scripts/import_roads.ts     OpenStreetMap -> road_segments (run once per area)
        |
collar / simulator  --POST(x-device-secret)-->  Edge Function: ingest
                                                      |
                                            src/engine  (pure, no I/O)
                                       veto -> features -> score -> Monte Carlo
                                                      |
                                          risk_state + alerts (Postgres)
                                                      |
                                          Supabase Realtime -> React PWA
```

### The engine is one implementation, three runtimes

`src/engine/` is dependency-free and uses explicit `.ts` import specifiers, so
the identical source runs in vitest, in the browser, and in Deno. Copying it
would mean two risk models that drift, and the one in production would be the
untested one. `scripts/sync_engine.mjs` + `scripts/bundle_functions.mjs` ship it
to the Edge Function as a single bundled file.

### Order of operations inside the engine

1. **§7.2 GPS veto** — a poor fix does not get a vote, it gets the evaluation
   cancelled. A bad fix can place an animal 50 m across a road she is nowhere
   near, and that false alarm costs more trust than a missed one.
2. **§7.3 closing speed** — `speed × cos(θ)`. Without it, every animal grazing
   *along* a roadside alerts forever and the farmer silences the app.
3. **§7.4 on-road overrides** — distance 0 and closing speed 0 means a naive
   approach-model scores a cow standing on a highway at nearly zero. That is
   the deadliest state in the problem domain, so it overrides the score.
4. **§7.5 herd separation** — free to compute, and very likely the strongest
   single predictor of straying.
5. **§7.6 weighted score** — explainable, no training data, `components` stored
   on every evaluation so "why did it fire?" is answered by opening the row.
6. **§7.7 Monte Carlo** — 500 futures sampled from the animal's own turn/speed
   distribution. The one real probability in the system.
7. **§7.9 state machine** — hysteresis, cooldown, escalation.

### Why §7.9 matters most

Alert fatigue is the number one way this system dies in the field. Not
accuracy — fatigue. The farmer mutes notifications in week two and the product
is dead while every metric still looks healthy. One worsening event produces at
most three notifications over its entire lifetime: warning, high, critical.

---

## Honesty rules (§13) — these are defects, not preferences

1. Never display a stale position without its age. Stale dots render hollow.
2. Never display a metric from simulated data without labelling it simulated.
3. Never display a probability with no definition behind it. `p_reaches_road_5min`
   is null unless the simulation actually ran.
4. When the traffic API is down, say the risk is using the fallback model.
5. When GPS is poor, say the collar cannot see the sky — do not guess.

---

## Commands

```bash
npm run dev            # Vite dev server
npm test               # 24 engine acceptance tests
npm run typecheck      # tsc --noEmit
npm run build          # production PWA build
npm run import:roads   # OpenStreetMap -> road_segments
npm run simulate       # virtual collars
node scripts/make_icons.mjs        # regenerate PWA icons
node scripts/sync_engine.mjs       # engine -> functions/_shared
node scripts/bundle_functions.mjs  # bundle functions for deploy
python3 scripts/simulate_herd.py   # Stage 2 training data (SIMULATED)
```

---

## What is deliberately not built (§12)

LoRa mesh visualisation, chat, marketplace, breeding/milk tracking, social
feeds, a native app, dark mode, gamification, admin analytics.

Dark mode in particular is not an oversight: the palette is tuned for maximum
contrast in direct sunlight, which is the opposite problem.

---

## Hardware

Firmware is out of scope for this build. The contract the collar must implement
is in [`docs/collar-contract.md`](docs/collar-contract.md) — packet format, the
GPS veto, closing-speed buzzer rules, the three fall gates, and the adaptive
reporting table.

Raw IMU never leaves the collar. The IMU samples at 50–100 Hz and the LoRa
packet is 18 bytes at 1% duty cycle; only the *conclusion* travels.

---

## Licence

Unlicensed / private.
# cow
# cow
