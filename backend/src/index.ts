import dns from 'node:dns';
import net from 'node:net';

// Enforce IPv4 on systems lacking an active IPv6 internet route
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

// Force family: 4 on all internal DNS lookups for undici, pg, and fetch
type DnsCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
const origLookup = dns.lookup;
// @ts-expect-error - overriding internal lookup options for ipv4 fallback
dns.lookup = function (
  hostname: string,
  options: dns.LookupOptions | number | DnsCallback,
  callback?: DnsCallback
) {
  let finalOptions: dns.LookupOptions | number = { family: 4 };
  let finalCallback = callback;

  if (typeof options === 'function') {
    finalCallback = options;
    finalOptions = { family: 4 };
  } else if (typeof options === 'number') {
    finalOptions = { family: 4 };
  } else if (typeof options === 'object' && options !== null) {
    finalOptions = { ...options, family: 4 };
  }
  return Reflect.apply(origLookup, dns, [hostname, finalOptions, finalCallback]);
};

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDb, pool } from './db.js';
import { initQdrant } from './services/qdrant.js';
import { syncRouter } from './routes/sync.js';
import { reindexRouter } from './routes/reindex.js';
import { askRouter } from './routes/ask.js';
import { conversationsRouter } from './routes/conversations.js';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// HTTP Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const url = req.originalUrl || req.url;
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusSymbol = status >= 500 ? '❌' : status >= 400 ? '⚠️' : '✔';
    console.log(`[HTTP] ${statusSymbol} ${req.method} ${url} -> ${status} (${duration}ms)`);
  });
  next();
});

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
app.use(conversationsRouter);

async function startServer(): Promise<void> {
  console.log('\n[Startup] Initializing Ask Saka backend services...');

  // 1. Verify PostgreSQL connection and schema migrations
  try {
    await initDb();
    console.log('✔ PostgreSQL connection and schema verified.');
  } catch (dbErr: unknown) {
    let rawMsg = String(dbErr);
    if (dbErr instanceof Error) {
      const code = 'code' in dbErr && typeof dbErr.code === 'string' ? dbErr.code : undefined;
      rawMsg = dbErr.message || code || String(dbErr);
    }
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
    let rawMsg = String(qdrantErr);
    if (qdrantErr instanceof Error) {
      const code = 'code' in qdrantErr && typeof qdrantErr.code === 'string' ? qdrantErr.code : undefined;
      rawMsg = qdrantErr.message || code || String(qdrantErr);
    }
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
