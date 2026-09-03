import { pool } from '../db.js';
import { config } from '../config.js';
import { qdrantClient, getModelCollectionName, initQdrant } from './qdrant.js';

/**
 * Completely clears all articles and locks from PostgreSQL and wipes the Qdrant collection.
 */
export async function clearAllDatabase(): Promise<{
  postgresArticlesCleared: boolean;
  postgresLocksCleared: boolean;
  qdrantCollectionReset: string;
}> {
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
  const modelColl = getModelCollectionName(config.QDRANT_COLLECTION_BASE, config.OPENROUTER_EMBED_MODEL);
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
