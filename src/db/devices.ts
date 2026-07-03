import { pool } from './pool.js';

export interface RegisterDeviceInput {
  userId: string;
  fcmToken: string;
  platform: string;
  deviceName?: string | null;
}

export interface UserDeviceRow {
  id: string;
  user_id: string;
  fcm_token: string;
  platform: string;
  device_name: string | null;
  notification_preferences: Record<string, unknown>;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const registerUserDevice = async (
  input: RegisterDeviceInput
): Promise<UserDeviceRow> => {
  const result = await pool.query<UserDeviceRow>(
    `INSERT INTO user_devices (
       user_id,
       fcm_token,
       platform,
       device_name,
       last_seen_at,
       updated_at,
       deleted_at
     )
     VALUES ($1, $2, $3, $4, NOW(), NOW(), NULL)
     ON CONFLICT (fcm_token) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       platform = EXCLUDED.platform,
       device_name = EXCLUDED.device_name,
       last_seen_at = NOW(),
       updated_at = NOW(),
       deleted_at = NULL
     RETURNING
       id,
       user_id,
       fcm_token,
       platform,
       device_name,
       notification_preferences,
       last_seen_at,
       created_at,
       updated_at,
       deleted_at`,
    [input.userId, input.fcmToken, input.platform, input.deviceName ?? null]
  );

  if (!result.rows[0]) {
    throw new Error('Failed to register device');
  }

  return result.rows[0];
};

export const unregisterUserDevice = async (
  userId: string,
  fcmToken: string
): Promise<void> => {
  await pool.query(
    `UPDATE user_devices
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1
       AND fcm_token = $2`,
    [userId, fcmToken]
  );
};
