import dns from 'node:dns';
import net from 'node:net';

// Prevent Node Happy Eyeballs from hanging when IPv6 route is unreachable
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDb, pool } from './db.js';
import { initQdrant } from './services/qdrant.js';
import { syncRouter } from './routes/sync.js';
import { reindexRouter } from './routes/reindex.js';
import { askRouter } from './routes/ask.js';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cee-tools-backend (Ask Saka)',
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
app.use(syncRouter);
app.use(reindexRouter);
app.use(askRouter);

async function startServer(): Promise<void> {
  console.log('\n[Startup] Initializing Ask Saka backend services...');

  // 1. Verify PostgreSQL connection and schema migrations
  try {
    await initDb();
    console.log('✔ PostgreSQL connection and schema verified.');
  } catch (dbErr: unknown) {
    const rawMsg = dbErr instanceof Error
      ? (dbErr.message || (dbErr as any)?.code || String(dbErr))
      : String(dbErr);
    const conciseMsg = rawMsg.split('\n')[0] || String(dbErr);
    console.error(`\n❌ [Database Error] Failed to connect to PostgreSQL: ${conciseMsg}`);
    console.error(`👉 Please verify that PostgreSQL is running and check DATABASE_URL in backend/.env\n`);
    process.exit(1);
  }

  // 2. Verify Qdrant collection and vector dimension probing
  try {
    const collectionName = await initQdrant();
    console.log(`✔ Qdrant collection verified: ${collectionName}`);
  } catch (qdrantErr: unknown) {
    const rawMsg = qdrantErr instanceof Error
      ? (qdrantErr.message || (qdrantErr as any).code || String(qdrantErr))
      : String(qdrantErr);
    const conciseMsg = rawMsg.split('\n')[0] || String(qdrantErr);
    console.error(`\n❌ [Qdrant Error] Failed to initialize Qdrant: ${conciseMsg}`);
    console.error(`👉 Please verify that Qdrant is running and check QDRANT_URL in backend/.env\n`);
    process.exit(1);
  }

  // 3. Start HTTP server only after all infrastructure is verified
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`\n=======================================================`);
    console.log(`  Ask Saka Backend Server listening on http://${config.HOST}:${config.PORT}`);
    console.log(`  - Embeddings Model : ${config.OPENROUTER_EMBED_MODEL}`);
    console.log(`  - Context Model    : ${config.OPENROUTER_CONTEXT_MODEL}`);
    console.log(`  - Rerank Model     : ${config.OPENROUTER_RERANK_MODEL}`);
    console.log(`  - Chat Model       : ${config.OPENROUTER_CHAT_MODEL}`);
    console.log(`=======================================================\n`);
  });

  const shutdown = async () => {
    console.log('\n[Shutdown] Closing HTTP server and database connections...');
    server.close(async () => {
      try {
        await pool.end();
      } catch { }
      console.log('[Shutdown] Cleanup completed. Exiting.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
