CREATE TABLE IF NOT EXISTS circuits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_label TEXT,
  breaker_rating REAL,
  voltage REAL,
  panel_ref TEXT,
  convention TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS wire_runs (
  id TEXT PRIMARY KEY,
  circuit_id TEXT NOT NULL REFERENCES circuits(id),
  from_endpoint TEXT,
  to_endpoint TEXT,
  gauge REAL,
  gauge_unit TEXT,
  color TEXT,
  length REAL,
  length_unit TEXT,
  zone TEXT,
  cable_label TEXT,
  switch_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_wire_runs_circuit_id ON wire_runs (circuit_id);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  zone TEXT,
  rated_power_w REAL,
  signalk_path TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments (owner_type, owner_id);

CREATE TABLE IF NOT EXISTS change_log (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  summary TEXT NOT NULL,
  diff_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_change_log_record ON change_log (record_type, record_id);
