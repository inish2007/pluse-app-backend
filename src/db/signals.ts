import { pool } from './pool.js';

export type SignalDeliveryStatus = 'pending' | 'delivered' | 'acknowledged' | 'failed' | 'expired';

const STATUS_ORDER: Record<SignalDeliveryStatus, number> = {
  pending: 0,
  delivered: 1,
  failed: 1,
  acknowledged: 2,
  expired: 3
};

const isValidForwardTransition = (
  currentStatus: SignalDeliveryStatus | null,
  nextStatus: SignalDeliveryStatus
): boolean => {
  if (!currentStatus || currentStatus === nextStatus) {
    return true;
  }

  if (currentStatus === 'acknowledged' || currentStatus === 'expired') {
    return false;
  }

  return STATUS_ORDER[nextStatus] >= STATUS_ORDER[currentStatus];
};

const transitionSignalStatus = async (
  signalId: string,
  nextStatus: SignalDeliveryStatus,
  options?: { setAcknowledgedAt?: boolean }
): Promise<boolean> => {
  const current = await pool.query<{ delivery_status: SignalDeliveryStatus | null }>(
    `SELECT delivery_status
     FROM signals
     WHERE id = $1
     LIMIT 1`,
    [signalId]
  );

  const currentStatus = current.rows[0]?.delivery_status ?? null;
  if (!isValidForwardTransition(currentStatus, nextStatus)) {
    console.info('[Signals] ignored backward transition', { signalId, currentStatus, nextStatus });
    return false;
  }

  const acknowledgedAtClause = options?.setAcknowledgedAt ? ', acknowledged_at = NOW()' : '';
  const result = await pool.query(
    `UPDATE signals
     SET delivery_status = $1${acknowledgedAtClause}
     WHERE id = $2
       AND (delivery_status = $3 OR delivery_status IS NULL OR delivery_status = $4)`,
    [nextStatus, signalId, currentStatus, nextStatus]
  );

  if (result.rowCount === 1) {
    console.info('[Signals] state transition', { signalId, from: currentStatus, to: nextStatus });
    return true;
  }

  return false;
};

export const markPending = async (signalId: string): Promise<boolean> => {
  return transitionSignalStatus(signalId, 'pending');
};

export const markDelivered = async (signalId: string): Promise<boolean> => {
  return transitionSignalStatus(signalId, 'delivered');
};

export const markAcknowledged = async (signalId: string): Promise<boolean> => {
  return transitionSignalStatus(signalId, 'acknowledged', { setAcknowledgedAt: true });
};

export const markFailed = async (signalId: string): Promise<boolean> => {
  return transitionSignalStatus(signalId, 'failed');
};

export const markExpired = async (signalId: string): Promise<boolean> => {
  return transitionSignalStatus(signalId, 'expired');
};

export const expireOldSignals = async (ttlHours: number): Promise<number> => {
  const result = await pool.query(
    `UPDATE signals
     SET delivery_status = 'expired'
     WHERE delivery_status IN ('pending', 'delivered', 'failed')
       AND created_at < NOW() - ($1 || ' hours')::interval`,
    [ttlHours]
  );

  const updatedCount = result.rowCount ?? 0;

  if (updatedCount > 0) {
    console.info('[Signals] expired old signals', { updatedCount, ttlHours });
  }

  return updatedCount;
};
