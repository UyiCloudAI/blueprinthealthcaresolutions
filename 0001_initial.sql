-- Starter schema only. Review with a security engineer and counsel before use.
-- Keep clinical notes and detailed PHI out of this initial platform schema.
PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organization_memberships (
  organization_id TEXT NOT NULL,
  identity_subject TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('org_admin', 'provider', 'scheduler', 'billing')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, identity_subject),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE provider_profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  identity_subject TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE appointment_slots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'held', 'booked', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (provider_id) REFERENCES provider_profiles(id)
);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  patient_identity_subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'completed', 'no_show')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'refunded', 'failed')),
  payment_provider_reference TEXT,
  video_room_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (slot_id) REFERENCES appointment_slots(id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  actor_identity_subject TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_slots_org_provider_start
  ON appointment_slots (organization_id, provider_id, starts_at);
CREATE INDEX idx_appointments_org_patient
  ON appointments (organization_id, patient_identity_subject, created_at);
