-- Telehealth Tech Solutions: initial schema (demo data only until HIPAA review)

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('patient', 'provider')),
  full_name     TEXT NOT NULL,
  specialty     TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- SHA-256 of the cookie token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE appointments (
  id          TEXT PRIMARY KEY,
  patient_id  TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT NOT NULL REFERENCES users(id),
  starts_at   TEXT NOT NULL,            -- UTC ISO-8601
  ends_at     TEXT NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  room_name   TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_appt_patient  ON appointments(patient_id, starts_at);
CREATE INDEX idx_appt_provider ON appointments(provider_id, starts_at);
-- Prevents two patients booking the same provider slot, even under concurrent requests.
CREATE UNIQUE INDEX idx_appt_no_double_book
  ON appointments(provider_id, starts_at) WHERE status = 'scheduled';

CREATE TABLE login_attempts (
  key        TEXT NOT NULL,             -- "email|ip"
  created_at INTEGER NOT NULL           -- unix seconds
);
CREATE INDEX idx_login_attempts ON login_attempts(key, created_at);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);
