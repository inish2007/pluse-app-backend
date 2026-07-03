-- Migration to add firebase_uid and updated_at to users, and ensure unique firebase_uid.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255) UNIQUE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
