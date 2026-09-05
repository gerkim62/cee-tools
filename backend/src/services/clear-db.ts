import { pool } from '../db.js';
import { config } from '../config.js';
import { qdrantClient, initQdrant } from './qdrant.js';

/**
 * Completely clears all articles and locks from PostgreSQL and wipes the Qdrant collection.
 * PROTECTED BY MULTIPLE SAFETY LOCKS AGAINST ACCIDENTAL PRODUCTION DESTRUCTION.
 */
export async function clearAllDatabase(): Promise<{
  postgresArticlesCleared: boolean;
  postgresLocksCleared: boolean;
  qdrantCollectionReset: string;
}> {
  const dbUrl = config.DATABASE_URL.toLowerCase();
  const isCloudOrProd =
    process.env.NODE_ENV === 'production' ||
    dbUrl.includes('prod') ||
    dbUrl.includes('neon') ||
    dbUrl.includes('supabase') ||
    dbUrl.includes('amazonaws') ||
    dbUrl.includes('rds') ||
    dbUrl.includes('safaricom') ||
    dbUrl.includes('cockroach') ||
    dbUrl.includes('railway') ||
    dbUrl.includes('render');

  const REQUIRED_PROD_CONFIRMATION = 'YES_I_AM_COMPLETELY_SURE_WIPE_PRODUCTION_DATABASE';
  const confirmationToken = process.env.DANGEROUSLY_ALLOW_PRODUCTION_DATABASE_WIPE;

  if (isCloudOrProd && confirmationToken !== REQUIRED_PROD_CONFIRMATION) {
    const errorMsg =
      `\n================================================================================\n` +
      `🛑 [CRITICAL DATABASE SAFETY GUARD ACTIVATED]\n` +
      `Attempted to execute database wipe against a production or cloud database!\n` +
      `Target URL: ${config.DATABASE_URL.replace(/:\/\/.*@/, '://***@')}\n\n` +
      `To prevent catastrophic data loss, database reset is strictly BLOCKED.\n` +
      `If this was intentional, you must explicitly set:\n` +
      `DANGEROUSLY_ALLOW_PRODUCTION_DATABASE_WIPE="${REQUIRED_PROD_CONFIRMATION}"\n` +
      `================================================================================\n`;
    console.error(errorMsg);
    throw new Error('Database wipe aborted by production safety lock.');
  }

  if (!process.env.ALLOW_DATABASE_RESET && !isCloudOrProd) {
    throw new Error('Database wipe aborted. Set ALLOW_DATABASE_RESET=true to proceed in development.');
  }

  console.log('[ClearDB] Starting full database reset...');

  // 1. Truncate PostgreSQL articles and sync_locks tables
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE articles CASCADE;');
    await client.query('TRUNCATE TABLE sync_locks CASCADE;');
    await client.query('COMMIT');
    console.log('[ClearDB] PostgreSQL articles and sync_locks tables truncated.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ClearDB Error] Failed to truncate PostgreSQL tables:', err);
    throw err;
  } finally {
    client.release();
  }

  // 2. Reset Qdrant Collection
  try {
    const collRes = await qdrantClient.getCollections();
    for (const coll of collRes.collections) {
      if (coll.name.startsWith(config.QDRANT_COLLECTION_BASE)) {
        console.log(`[ClearDB] Deleting Qdrant collection ${coll.name}...`);
        await qdrantClient.deleteCollection(coll.name);
        console.log(`[ClearDB] Qdrant collection ${coll.name} deleted.`);
      }
    }

    // Recreate collection and index
    const collectionName = await initQdrant();
    console.log(`[ClearDB] Qdrant collection ${collectionName} recreated and ready.`);
    return {
      postgresArticlesCleared: true,
      postgresLocksCleared: true,
      qdrantCollectionReset: collectionName,
    };
  } catch (qErr) {
    console.error('[ClearDB Error] Failed to reset Qdrant collection:', qErr);
    throw qErr;
  }
}

// Standalone CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  clearAllDatabase()
    .then((result) => {
      console.log('[ClearDB] Database successfully wiped:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ClearDB] Failed to wipe database:', err);
      process.exit(1);
    });
}
