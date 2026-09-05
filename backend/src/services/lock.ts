import { query } from '../db.js';
import { config } from '../config.js';
import { SAKAHUB_CONSTANTS } from '../constants.js';

const LOCK_KEY = SAKAHUB_CONSTANTS.SYNC_LOCK_KEY;

export interface LockStatus {
  isLocked: boolean;
  clientId?: string;
  acquiredAt?: Date;
  expiresAt?: Date;
}

export async function getLockStatus(): Promise<LockStatus> {
  const res = await query<{ client_id: string; acquired_at: string; expires_at: string }>(
    `SELECT client_id, acquired_at, expires_at 
     FROM sync_locks 
     WHERE lock_key = $1 AND expires_at > NOW()`,
    [LOCK_KEY]
  );

  if (res.rowCount && res.rowCount > 0 && res.rows[0]) {
    const row = res.rows[0];
    return {
      isLocked: true,
      clientId: row.client_id,
      acquiredAt: new Date(row.acquired_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  return { isLocked: false };
}

export async function acquireLock(clientId: string): Promise<{ acquired: boolean; expiresAt?: Date; currentHolder?: string }> {
  const current = await getLockStatus();

  if (current.isLocked && current.clientId !== clientId) {
    return {
      acquired: false,
      expiresAt: current.expiresAt,
      currentHolder: current.clientId,
    };
  }

  const ttlMinutes = config.SYNC_LOCK_TTL_MINUTES;
  const res = await query<{ expires_at: string }>(
    `INSERT INTO sync_locks (lock_key, client_id, acquired_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + ($3 || ' minutes')::INTERVAL)
     ON CONFLICT (lock_key) DO UPDATE
     SET client_id = EXCLUDED.client_id,
         acquired_at = NOW(),
         expires_at = EXCLUDED.expires_at
     RETURNING expires_at`,
    [LOCK_KEY, clientId, ttlMinutes.toString()]
  );

  const row = res.rows[0];
  return {
    acquired: true,
    expiresAt: row ? new Date(row.expires_at) : undefined,
  };
}

export async function refreshLock(clientId?: string): Promise<{ refreshed: boolean; expiresAt?: Date }> {
  const ttlMinutes = config.SYNC_LOCK_TTL_MINUTES;
  let sql = `UPDATE sync_locks 
             SET expires_at = NOW() + ($1 || ' minutes')::INTERVAL 
             WHERE lock_key = $2`;
  const params: unknown[] = [ttlMinutes.toString(), LOCK_KEY];

  if (clientId) {
    sql += ` AND client_id = $3`;
    params.push(clientId);
  }

  sql += ` RETURNING expires_at`;

  const res = await query<{ expires_at: string }>(sql, params);
  const row = res.rows[0];
  if (res.rowCount && res.rowCount > 0 && row) {
    return {
      refreshed: true,
      expiresAt: new Date(row.expires_at),
    };
  }

  return { refreshed: false };
}

export async function releaseLock(clientId?: string): Promise<boolean> {
  let sql = `DELETE FROM sync_locks WHERE lock_key = $1`;
  const params: unknown[] = [LOCK_KEY];

  if (clientId) {
    sql += ` AND client_id = $2`;
    params.push(clientId);
  }

  const res = await query(sql, params);
  return (res.rowCount ?? 0) > 0;
}
