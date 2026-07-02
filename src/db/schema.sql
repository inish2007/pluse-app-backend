-- d:\project\pluse-app-backend\src\db\schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Assuming a basic users table exists or will be created
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    acknowledged_at TIMESTAMP WITH TIME ZONE -- When recipient saw it
);

-- Indexes for fast lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_invites_token_hash ON invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_invites_short_code ON invites(short_code);
CREATE INDEX IF NOT EXISTS idx_invites_expires_at ON invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_couples_users ON couples(user1_id, user2_id);
CREATE INDEX IF NOT EXISTS idx_signals_recipient_couple ON signals(recipient_id, couple_id);
CREATE INDEX IF NOT EXISTS idx_signals_couple_created ON signals(couple_id, created_at DESC);
