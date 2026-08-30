-- PashuGuard — core schema (§4)
-- Geometry lives in SQL (PostGIS), not in hand-rolled application math.

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- People ------------------------------------------------------------------
create table farmers (
  id         uuid primary key default gen_random_uuid(),
  auth_uid   uuid unique references auth.users(id) on delete cascade,
  phone      text unique not null,
  name       text not null,
  village    text,
  language   text default 'en' check (language in ('en','hi','kn')),
  created_at timestamptz default now()
);

create table helpers (
  id                uuid primary key default gen_random_uuid(),
  farmer_id         uuid references farmers(id) on delete cascade,
  name              text not null,
  phone             text not null,
  receives_critical boolean default true
);
create index on helpers (farmer_id);

-- Animals & devices -------------------------------------------------------
create table animals (
  id                uuid primary key default gen_random_uuid(),
  farmer_id         uuid references farmers(id) on delete cascade,
  name              text not null,
  pashu_aadhaar_tag text unique,
  photo_url         text,
  breed             text,
  public_slug       text unique not null,
  is_active         boolean default true,
  created_at        timestamptz default now()
);
create index on animals (farmer_id) where is_active;

create table devices (
  id           uuid primary key default gen_random_uuid(),
  device_key   text unique not null,
  animal_id    uuid references animals(id) on delete set null,
  battery_pct  smallint,
  last_seen_at timestamptz,
  firmware     text
);
create index on devices (animal_id);

-- Telemetry ---------------------------------------------------------------
-- Mirrors the 18-byte collar packet exactly. Nothing more fits over LoRa.
create table telemetry (
  id             bigserial primary key,
  device_id      uuid references devices(id) on delete cascade,
  animal_id      uuid references animals(id) on delete cascade,
  position       geography(Point, 4326) not null,
  speed_kmh      real,
  heading_deg    smallint,
  fix_quality    smallint,   -- 0 none, 1 2D, 2 3D, 3 3D+good HDOP
  hdop           real,
  sats           smallint,
  battery_pct    smallint,
  movement_state smallint,   -- 0 still, 1 grazing, 2 walking, 3 running
  event_code     smallint default 0,
                 -- 0 heartbeat, 1 motion, 2 geofence, 3 road_approach,
                 -- 4 fall, 5 on_road, 6 tamper
  seq            integer,
  -- Set when the fix fails the §7.2 veto. Row is still stored; risk is skipped.
  poor_fix       boolean default false,
  recorded_at    timestamptz not null,
  received_at    timestamptz default now()
);
create index on telemetry using gist (position);
create index on telemetry (animal_id, recorded_at desc);
-- Idempotency: a collar retrying over flaky LoRa must not double-insert.
create unique index telemetry_device_seq_uniq on telemetry (device_id, seq)
  where seq is not null;

-- Zones & roads -----------------------------------------------------------
create table grazing_zones (
  id          uuid primary key default gen_random_uuid(),
  farmer_id   uuid references farmers(id) on delete cascade,
  name        text not null,
  boundary    geography(Polygon, 4326) not null,
  buffer_m    integer default 30,
  active_from time,
  active_to   time,
  is_enabled  boolean default true,
  drawn_by    text check (drawn_by in ('polygon','walk'))
);
create index on grazing_zones using gist (boundary);
create index on grazing_zones (farmer_id) where is_enabled;

create table road_segments (
  id            bigserial primary key,
  osm_id        bigint,
  name          text,
  highway_class text not null,
  base_risk     smallint not null check (base_risk between 1 and 5),
  geom          geography(LineString, 4326) not null
);
create index on road_segments using gist (geom);
create index on road_segments (base_risk desc);

create table traffic_snapshots (
  id                bigserial primary key,
  road_segment_id   bigint references road_segments(id) on delete cascade,
  current_speed_kmh real,
  free_flow_kmh     real,
  confidence        real,
  fetched_at        timestamptz default now()
);
create index on traffic_snapshots (road_segment_id, fetched_at desc);

-- Risk state --------------------------------------------------------------
-- One live row per animal. This is what makes hysteresis and cooldown work.
create table risk_state (
  animal_id           uuid primary key references animals(id) on delete cascade,
  state               text not null default 'safe'
                      check (state in ('safe','watch','warning','high','critical')),
  situation           text not null default 'normal'
                      check (situation in ('normal','approaching_road','on_road',
                             'stationary_on_road','outside_zone','possible_injury',
                             'device_fault')),
  road_risk           smallint default 0 check (road_risk between 0 and 100),
  geofence_risk       smallint default 0 check (geofence_risk between 0 and 100),
  injury_risk         smallint default 0 check (injury_risk between 0 and 100),
  p_reaches_road_5min real check (p_reaches_road_5min between 0 and 1),
  -- Supports stationary_on_road (§7.4): sustained > 60s, not instantaneous.
  stationary_since    timestamptz,
  on_road_since       timestamptz,
  poor_fix_since      timestamptz,
  last_alert_at       timestamptz,
  last_alert_kind     text,
  active_alert_id     uuid,
  components          jsonb,
  updated_at          timestamptz default now()
);

create table alerts (
  id                  uuid primary key default gen_random_uuid(),
  animal_id           uuid references animals(id) on delete cascade,
  farmer_id           uuid references farmers(id) on delete cascade,
  kind                text not null
                      check (kind in ('road_risk','on_road','geofence','fall',
                             'low_battery','offline','gps_fault')),
  severity            text not null check (severity in ('warning','high','critical')),
  position            geography(Point, 4326),
  road_name           text,
  distance_m          integer,
  ttr_seconds         integer,
  p_reaches_road_5min real,
  components          jsonb,
  message             text,
  -- Upgrade chain, not a new alert (§7.9).
  escalated_from      uuid references alerts(id),
  -- False when the row was updated silently (state flat/falling).
  notified            boolean default true,
  resolved_at         timestamptz,
  created_at          timestamptz default now()
);
create index on alerts (farmer_id, created_at desc);
create index on alerts (animal_id, created_at desc);
create index on alerts (animal_id) where resolved_at is null;

alter table risk_state
  add constraint risk_state_active_alert_fk
  foreign key (active_alert_id) references alerts(id) on delete set null;

create table scan_events (
  id               uuid primary key default gen_random_uuid(),
  animal_id        uuid references animals(id) on delete set null,
  scanned_tag      text not null,
  scanner_position geography(Point, 4326),
  outcome          text check (outcome in ('owner_contacted','routed_to_authority','unknown_tag')),
  created_at       timestamptz default now()
);
create index on scan_events (animal_id, created_at desc);
