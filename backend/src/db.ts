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

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[]
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

    // Create conversations table for multi-turn chat history
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        title TEXT NOT NULL,
        is_compacted BOOLEAN NOT NULL DEFAULT FALSE,
        summary TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_compacted BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary TEXT;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at ON conversations(deleted_at);
    `);

    // Create messages table for message turns with citations
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        parent_id UUID REFERENCES messages(id) ON DELETE CASCADE,
        role VARCHAR(16) NOT NULL,
        content TEXT NOT NULL,
        citations JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES messages(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);
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
