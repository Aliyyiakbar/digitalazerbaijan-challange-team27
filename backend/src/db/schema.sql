-- Smart Transit Baku — sxem (idempotent)

CREATE TABLE IF NOT EXISTS stops (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS routes (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('express','regular')),
  color        TEXT NOT NULL,
  headway_min  INTEGER NOT NULL,
  capacity     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS route_stops (
  route_id  TEXT NOT NULL REFERENCES routes(id),
  seq       INTEGER NOT NULL,
  stop_id   TEXT NOT NULL REFERENCES stops(id),
  dir       SMALLINT NOT NULL,
  dist_m    DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (route_id, seq)
);

CREATE TABLE IF NOT EXISTS buses (
  id         TEXT PRIMARY KEY,
  route_id   TEXT NOT NULL REFERENCES routes(id),
  label      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reserve','depot')),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  first_seen  TIMESTAMPTZ NOT NULL,
  trust       DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  reports     INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'app'
);

CREATE TABLE IF NOT EXISTS crowd_reports (
  id           TEXT PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL,
  route_id     TEXT NOT NULL REFERENCES routes(id),
  bus_id       TEXT,
  stop_id      TEXT,
  context      TEXT NOT NULL CHECK (context IN ('bus','stop')),
  level        SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  device_id    TEXT NOT NULL,
  ip_hash      TEXT NOT NULL,
  has_geo      BOOLEAN NOT NULL,
  distance_m   DOUBLE PRECISION,           -- koordinatın özü saxlanılmır (məxfilik)
  geo_weight   DOUBLE PRECISION NOT NULL,
  trust        DOUBLE PRECISION NOT NULL,
  quarantined  BOOLEAN NOT NULL DEFAULT false,
  source       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crowd_reports_route_ts ON crowd_reports(route_id, ts DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  route_id        TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','ack','resolved')),
  title           TEXT NOT NULL,
  recommendation  TEXT NOT NULL,
  confidence      DOUBLE PRECISION,
  badge           TEXT NOT NULL,
  explanation     JSONB NOT NULL DEFAULT '{}'::jsonb,
  dispatched_bus  TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_created ON alerts(created_at DESC);

-- Vaxt maşını və proqnoz modeli üçün xətt göstəricilərinin anlıq görüntüləri
CREATE TABLE IF NOT EXISTS snapshots (
  ts          TIMESTAMPTZ NOT NULL,
  route_id    TEXT NOT NULL,
  score       DOUBLE PRECISION,
  confidence  DOUBLE PRECISION,
  buses       INTEGER NOT NULL,
  reports     INTEGER NOT NULL,
  speed_kmh   DOUBLE PRECISION,
  headway_cv  DOUBLE PRECISION,
  cause       TEXT,
  synthetic   BOOLEAN NOT NULL DEFAULT false,
  positions   JSONB,
  PRIMARY KEY (route_id, ts)
);
CREATE INDEX IF NOT EXISTS snapshots_ts ON snapshots(ts);

CREATE TABLE IF NOT EXISTS stop_dwell_events (
  bus_id     TEXT NOT NULL,
  route_id   TEXT NOT NULL,
  stop_id    TEXT NOT NULL,
  arrived    TIMESTAMPTZ NOT NULL,
  departed   TIMESTAMPTZ NOT NULL,
  dwell_s    DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS dwell_route_time ON stop_dwell_events(route_id, departed DESC);
