import { pool } from '../db/pool.js';
import { markDelivered, markFailed } from '../db/signals.js';
import { firebaseMessaging } from '../firebase/admin.js';

export interface SignalDeliveryPayload {
  signalId: string;
  signalType: string;
  senderId: string;
  coupleId: string;
  type?: string;
}

export interface DeviceDeliveryResult {
  token: string;
  success: boolean;
  invalidToken: boolean;
}

export interface FcmDeliveryResult {
  delivered: boolean;
  deviceResults: DeviceDeliveryResult[];
}

const buildNotification = (payload: SignalDeliveryPayload) => ({
  notification: {
    title: 'Pulse',
    body: 'You received a new signal.'
  },
  data: {
    signalId: payload.signalId,
    signalType: payload.signalType,
    senderId: payload.senderId,
    coupleId: payload.coupleId
  }
});

const cleanupInvalidToken = async (userId: string, token: string) => {
  await pool.query(
    `UPDATE user_devices
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1
       AND fcm_token = $2
       AND deleted_at IS NULL`,
    [userId, token]
  );
  console.info('[FCM] invalid token removed', { userId });
};

export const sendNotificationToAllActiveDevices = async (
  userId: string,
  payload: SignalDeliveryPayload
): Promise<FcmDeliveryResult> => {
  const devices = await pool.query<{ fcm_token: string }>(
    `SELECT fcm_token
     FROM user_devices
     WHERE user_id = $1
       AND deleted_at IS NULL`,
    [userId]
  );

  if (devices.rows.length === 0) {
    return { delivered: false, deviceResults: [] };
  }

  const tokens = devices.rows.map((device) => device.fcm_token);
  const message = buildNotification(payload);
  if (!firebaseMessaging) {
    console.warn('[FCM] Firebase messaging is unavailable');
    return { delivered: false, deviceResults: [] };
  }

  const response = await firebaseMessaging.sendEachForMulticast({
    tokens,
    notification: message.notification,
    data: message.data
  });

  const deviceResults: DeviceDeliveryResult[] = [];
  let anySuccess = false;

  for (let index = 0; index < response.responses.length; index++) {
    const result = response.responses[index];
    const token = tokens[index];

    if (!result) {
      if (token) {
        deviceResults.push({ token, success: false, invalidToken: false });
      }
      continue;
    }

    if (result.success) {
      if (token) {
        deviceResults.push({ token, success: true, invalidToken: false });
      }
      anySuccess = true;
      continue;
    }

    const errorCode = (result.error as any)?.code as string | undefined;
    const invalidToken =
      errorCode === 'messaging/registration-token-not-registered' ||
      errorCode === 'messaging/invalid-registration-token';

    if (token) {
      deviceResults.push({ token, success: false, invalidToken });
    }

    if (
      invalidToken
    ) {
      if (!token) {
        continue;
      }
      await cleanupInvalidToken(userId, token);
      console.info('[FCM] device delivery invalid token cleaned up', { userId });
    } else {
      console.warn('[FCM] device delivery failed', { userId, errorCode });
    }
  }

  if (anySuccess) {
    console.info('[FCM] sent notification', { userId });
  }

  return { delivered: anySuccess, deviceResults };
};

export const sendPushNotificationFallback = async (
  userId: string,
  payload: SignalDeliveryPayload
): Promise<FcmDeliveryResult> => {
  try {
    return await sendNotificationToAllActiveDevices(userId, payload);
  } catch (error) {
    console.error('[FCM] failed to send notification', { userId, error });
    return { delivered: false, deviceResults: [] };
  }
};

export const markSignalDelivered = async (signalId: string) => {
  await markDelivered(signalId);
};

export const markSignalFailed = async (signalId: string) => {
  await markFailed(signalId);
};
