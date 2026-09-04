import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { OPENROUTER_CONSTANTS, SAKAHUB_CONSTANTS } from './constants.js';

// Load environment variables from backend/.env or cwd .env
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const configSchema = z.object({
  // Mandatory Infrastructure Credentials (Uncompromisable - No Defaults, No Optionals)
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required (e.g. postgresql://user:pass@host:5432/dbname)' })
    .min(1, 'DATABASE_URL cannot be empty'),

  OPENROUTER_API_KEY: z
    .string({ required_error: 'OPENROUTER_API_KEY is required (e.g. sk-or-v1-...)' })
    .min(1, 'OPENROUTER_API_KEY cannot be empty'),

  QDRANT_URL: z
    .string({ required_error: 'QDRANT_URL is required (e.g. https://xyz.cloud.qdrant.io:6333)' })
    .min(1, 'QDRANT_URL cannot be empty'),

  QDRANT_API_KEY: z
    .string({ required_error: 'QDRANT_API_KEY is required' })
    .min(1, 'QDRANT_API_KEY cannot be empty'),

  // Server Networking
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // External Endpoints
  OPENROUTER_BASE_URL: z.string().default(OPENROUTER_CONSTANTS.DEFAULT_BASE_URL),
  SAKAHUB_BASE_URL: z.string().default(SAKAHUB_CONSTANTS.DEFAULT_BASE_URL),

  // AI Models (Defaulted with .env overrides)
  OPENROUTER_CHAT_MODEL: z.string().default('anthropic/claude-sonnet-4'),
  OPENROUTER_EMBED_MODEL: z.string().default('openai/text-embedding-3-large'),
  OPENROUTER_CONTEXT_MODEL: z.string().default('anthropic/claude-haiku-4.5'),
  OPENROUTER_RERANK_MODEL: z.string().default('cohere/rerank-v3.5'),
  QUERY_TRANSLATION_MODEL: z.string().default('openai/gpt-4o-mini'),

  // Vector Collection Base
  QDRANT_COLLECTION_BASE: z.string().default('saka_articles'),

  // Operational Tuning & RAG Hyperparameters
  SYNC_LOCK_TTL_MINUTES: z.coerce.number().default(3),
  CHUNK_SIZE: z.coerce.number().default(512),
  CHUNK_OVERLAP: z.coerce.number().default(75),
  RETRIEVAL_CANDIDATES: z.coerce.number().default(30),
  RERANK_TOP_K: z.coerce.number().default(15),
  ARTICLE_FLAG_BOOST: z.coerce.number().default(1.15),
});

export type Config = z.infer<typeof configSchema>;

let parsedConfig: Config;

try {
  parsedConfig = configSchema.parse(process.env);
} catch (error: unknown) {
  if (error instanceof z.ZodError) {
    console.error('\n================================================================================');
    console.error('❌ [Ask Saka Backend - Configuration Error]');
    console.error('The following mandatory infrastructure credentials are missing in backend/.env:\n');
    for (const issue of error.issues) {
      console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\n👉 Please copy backend/.env.example to backend/.env and configure your credentials.');
    console.error('================================================================================\n');
    process.exit(1);
  } else {
    throw error;
  }
}

export const config = parsedConfig;
