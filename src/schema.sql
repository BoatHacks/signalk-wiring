CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);

-- A circuit record is never created by hand: it follows the circuit derived
-- from the cables (src/circuits.js). `key` is protector:<device id> or
-- cable:<first cable id>; `cable_ids` is the JSON list of the cables it had
-- when last synced, used to carry a name over when the key changes. `voltage`
-- is an optional override of the derived voltage.
CREATE TABLE IF NOT EXISTS circuits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT,
  cable_ids TEXT,
  voltage REAL,
  convention TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS wire_runs (
  id TEXT PRIMARY KEY,
  from_device_id TEXT REFERENCES devices(id),
  to_device_id TEXT REFERENCES devices(id),
  gauge REAL,
  gauge_unit TEXT,
  length REAL,
  length_unit TEXT,
  zone TEXT,
  cable_label TEXT,
  switch_ref TEXT,
  route TEXT,
  zone_id TEXT REFERENCES zones(id),
  tags TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT
);

-- The conductors inside one cable (a wire run). A conductor may land on
-- other devices than the cable's ends (for example a negative landing on a
-- negative bus bar) and optionally on named terminals.
CREATE TABLE IF NOT EXISTS wire_run_conductors (
  id TEXT PRIMARY KEY,
  wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
  position INTEGER NOT NULL,
  conductor TEXT NOT NULL,
  color TEXT,
  from_device_id TEXT REFERENCES devices(id),
  to_device_id TEXT REFERENCES devices(id),
  from_terminal TEXT,
  to_terminal TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  role TEXT NOT NULL DEFAULT 'consumer',
  icon_attachment_id TEXT,
  zone TEXT,
  rated_power_w REAL,
  signalk_path TEXT,
  trip_rating_a REAL,
  nominal_voltage REAL,
  power_factor REAL,
  pos_x REAL,
  pos_y REAL,
  pos_z REAL,
  zone_id TEXT REFERENCES zones(id),
  tags TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS device_terminals (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  conductor TEXT NOT NULL,
  voltage REAL,
  port TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  view TEXT NOT NULL CHECK (view IN ('top', 'side')),
  filename TEXT,
  z_min REAL,
  z_max REAL,
  calibration TEXT,
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

CREATE TABLE IF NOT EXISTS conduits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT,
  inner_diameter REAL,
  diameter_unit TEXT,
  zone TEXT,
  zone_id TEXT REFERENCES zones(id),
  route TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS wire_run_conduits (
  wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
  conduit_id TEXT NOT NULL REFERENCES conduits(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (wire_run_id, conduit_id)
);

CREATE INDEX IF NOT EXISTS idx_wire_run_conduits_conduit ON wire_run_conduits (conduit_id);

-- Schematics (plan 0016): named diagrams of the electrical system. A device
-- can sit on several pages, each with its own position. Wires are not stored:
-- the cables between two devices on a page appear there by themselves. A
-- schematic_wires row exists only for a cable the user bent; `points` is the
-- JSON list of {x, y} bend points.
CREATE TABLE IF NOT EXISTS schematics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS schematic_devices (
  id TEXT PRIMARY KEY,
  schematic_id TEXT NOT NULL REFERENCES schematics(id),
  position INTEGER NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  x REAL NOT NULL,
  y REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS schematic_wires (
  id TEXT PRIMARY KEY,
  schematic_id TEXT NOT NULL REFERENCES schematics(id),
  position INTEGER NOT NULL,
  wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
  points TEXT
);

CREATE INDEX IF NOT EXISTS idx_schematic_devices_schematic ON schematic_devices (schematic_id);
CREATE INDEX IF NOT EXISTS idx_schematic_wires_schematic ON schematic_wires (schematic_id);
