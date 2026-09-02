import dns from 'node:dns';
import net from 'node:net';
import pg from 'pg';
import { config } from './config.js';

// Prevent Node Happy Eyeballs from hanging when IPv6 route is unreachable
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create articles registry table
    await client.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id VARCHAR(128) PRIMARY KEY,
        article_number VARCHAR(128),
        title TEXT NOT NULL,
        last_updated TIMESTAMPTZ NOT NULL,
        published_at TIMESTAMPTZ,
        article_flag VARCHAR(64) DEFAULT 'Default',
        indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE articles ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
      ALTER TABLE articles ADD COLUMN IF NOT EXISTS article_flag VARCHAR(64) DEFAULT 'Default';
    `);

    // Create index on last_updated for quick max() queries and diffs
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_articles_last_updated ON articles(last_updated);
    `);

    // Create sync locks table for distributed concurrency control
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_locks (
        lock_key VARCHAR(64) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);

    await client.query('COMMIT');
    console.log('[Database] PostgreSQL tables and indexes verified successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Database Error] Failed to initialize PostgreSQL tables:', error);
    throw error;
  } finally {
    client.release();
  }
}
