-- d:\project\pluse-app-backend\src\db\schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Assuming a basic users table exists or will be created
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid VARCHAR(255) UNIQUE,
    personal_code VARCHAR(12),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS personal_code VARCHAR(12);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
    ON users (firebase_uid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_personal_code
    ON users (personal_code);

-- Represents a pair of users
CREATE TABLE IF NOT EXISTS couples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id UUID NOT NULL REFERENCES users(id),
    user2_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- Null until partner joins
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Represents an expiring invite link
CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hash of the secure 256-bit token
    short_code VARCHAR(10) UNIQUE, -- 6-character manually typable code
    creator_id UUID NOT NULL REFERENCES users(id),
    couple_id UUID NOT NULL REFERENCES couples(id),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stores vibration signals between partners
CREATE TABLE IF NOT EXISTS signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id),
    recipient_id UUID NOT NULL REFERENCES users(id),
    couple_id UUID NOT NULL REFERENCES couples(id),
    signal_type VARCHAR(50) NOT NULL, -- 'vibrate', 'heart', 'kiss', 'thinking', etc
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    acknowledged_at TIMESTAMP WITH TIME ZONE -- When recipient saw it
);

ALTER TABLE signals
    ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending';

ALTER TABLE signals
    DROP CONSTRAINT IF EXISTS signals_delivery_status_check;

ALTER TABLE signals
    ADD CONSTRAINT signals_delivery_status_check
    CHECK (delivery_status IN ('pending', 'delivered', 'acknowledged', 'failed', 'expired'));

-- Indexes for fast lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_invites_token_hash ON invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_invites_short_code ON invites(short_code);
CREATE INDEX IF NOT EXISTS idx_invites_expires_at ON invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_couples_users ON couples(user1_id, user2_id);
CREATE INDEX IF NOT EXISTS idx_signals_recipient_couple ON signals(recipient_id, couple_id);
CREATE INDEX IF NOT EXISTS idx_signals_couple_created ON signals(couple_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_recipient_delivery_status ON signals(recipient_id, delivery_status);

-- Stores registered FCM devices for push notifications.
-- A user can have multiple active devices, each tracked by its FCM token.
CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fcm_token TEXT NOT NULL,
    platform VARCHAR(20) NOT NULL,
    device_name TEXT NULL,
    notification_preferences JSONB DEFAULT '{}'::jsonb,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    UNIQUE (fcm_token),
    UNIQUE (user_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_last_seen_at ON user_devices(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_user_devices_active
    ON user_devices(user_id, last_seen_at DESC)
    WHERE deleted_at IS NULL;
