import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { acquireLock, releaseLock, getLockStatus } from '../services/lock.js';
import { getActiveCollectionName } from '../services/qdrant.js';
import { clearAllDatabase } from '../services/clear-db.js';

export const syncRouter: Router = Router();

/**
 * POST /db/clear
 * Wipes all records from PostgreSQL and resets the Qdrant vector collection.
 */
syncRouter.post('/db/clear', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await clearAllDatabase();
    res.json({
      success: true,
      message: 'Knowledge base database completely cleared.',
      result,
    });
  } catch (error: any) {
    console.error('[Sync Router Error] Failed to clear database:', error);
    res.status(500).json({ error: 'Failed to clear database', message: error.message });
  }
});

/**
 * GET /sync-status
 * Lightweight probe endpoint for extension to compare totalElements and maxLastUpdated.
 */
syncRouter.get('/sync-status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const statsRes = await query(
      `SELECT COUNT(*)::int AS total_indexed, MAX(last_updated) AS max_last_updated FROM articles`
    );

    const row = statsRes.rows[0];
    const lockStatus = await getLockStatus();

    res.json({
      totalIndexed: row?.total_indexed || 0,
      maxLastUpdated: row?.max_last_updated ? new Date(row.max_last_updated).toISOString() : null,
      isSyncing: lockStatus.isLocked,
      lockExpiresAt: lockStatus.expiresAt ? lockStatus.expiresAt.toISOString() : null,
      activeCollection: getActiveCollectionName(),
    });
  } catch (error: any) {
    console.error('[Sync Router Error] Failed to get sync status:', error);
    res.status(500).json({ error: 'Failed to retrieve sync status', message: error.message });
  }
});

/**
 * GET /articles/versions
 * Returns a complete map of { [articleId]: lastUpdated } for exact client-side set diffing.
 */
syncRouter.get('/articles/versions', async (_req: Request, res: Response): Promise<void> => {
  try {
    const resVersions = await query<{ id: string; last_updated: Date }>(
      `SELECT id, last_updated FROM articles`
    );

    const versions: Record<string, string> = {};
    for (const row of resVersions.rows) {
      versions[row.id] = new Date(row.last_updated).toISOString();
    }

    res.json(versions);
  } catch (error: any) {
    console.error('[Sync Router Error] Failed to get article versions:', error);
    res.status(500).json({ error: 'Failed to retrieve article versions', message: error.message });
  }
});

/**
 * POST /sync/lock
 * Extension requests lock before initiating scraping to prevent concurrent runs.
 */
syncRouter.post('/sync/lock', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId } = req.body;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const result = await acquireLock(clientId);
    if (!result.acquired) {
      console.warn(`[Sync:Lock] ⚠️ Lock rejected for client "${clientId}". Current holder: "${result.currentHolder}" (expires: ${result.expiresAt?.toISOString()})`);
      res.status(409).json({
        acquired: false,
        message: 'Sync is currently in progress by another client',
        expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
        currentHolder: result.currentHolder,
      });
      return;
    }

    console.log(`[Sync:Lock] 🔒 Sync lock acquired by client "${clientId}" (expires: ${result.expiresAt?.toISOString()})`);
    res.json({
      acquired: true,
      expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
    });
  } catch (error: any) {
    console.error('[Sync Router Error] Failed to acquire lock:', error);
    res.status(500).json({ error: 'Failed to acquire lock', message: error.message });
  }
});

/**
 * POST /sync/unlock
 * Extension releases lock after completing sync.
 */
syncRouter.post('/sync/unlock', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId } = req.body;
    await releaseLock(clientId);
    console.log(`[Sync:Lock] 🔓 Sync lock released by client "${clientId || 'anon'}".`);
    res.json({ released: true });
  } catch (error: any) {
    console.error('[Sync Router Error] Failed to release lock:', error);
    res.status(500).json({ error: 'Failed to release lock', message: error.message });
  }
});
