/**
 * Centralized Application Constants for Ask Saka Backend
 */

export const SAKAHUB_CONSTANTS = {
  DEFAULT_BASE_URL: 'https://sakahub.safaricom.co.ke',
  DEFAULT_ARTICLE_FLAG: 'Default',
  BOOSTED_FLAGS: ['KeyUpdates', 'Featured'] as const,
  SYNC_LOCK_KEY: 'sakahub_sync',
} as const;

export const OPENROUTER_CONSTANTS = {
  DEFAULT_BASE_URL: 'https://openrouter.ai/api/v1',
  DEFAULT_CHAT_TEMPERATURE: 0.2,
  DIMENSION_PROBE_TOKEN: 'dimension_probe',
  CONTEXTUAL_ENRICHMENT: {
    MAX_TOKENS: 150,
    TEMPERATURE: 0.1,
    TIMEOUT_MS: 8000,
    CONCURRENCY: 5,
  },
} as const;

export const RAG_CONSTANTS = {
  QUERY_TRANSLATION_TEMPERATURE: 0.0,
  FALLBACK_EMBEDDING_DIMENSION: 3072,
  SPARSE_VOCABULARY_SIZE: 100000,
  PREFETCH_CANDIDATE_MULTIPLIER: 2,
  NETWORK_RETRY: {
    MAX_RETRIES: 3,
    INITIAL_DELAY_MS: 1500,
  },
  TEXT_FRAGMENT: {
    RANGE_THRESHOLD_WORDS: 10,
    SLICE_WORDS_COUNT: 4,
  },
  CITATIONS: {
    FALLBACK_COUNT: 3,
    MAX_PREVIEW_LENGTH: 100,
    MAX_FALLBACK_QUOTE_LENGTH: 120,
  },
  SPLITTER_SEPARATORS: ['\n\n', '\n', '. ', ' ', ''],
} as const;

export const CEE_STATUS_MESSAGES = {
  UNDERSTANDING: 'Understanding request...',
  SEARCHING: 'Searching SakaHub...',
  REVIEWING: 'Reviewing procedures...',
  DRAFTING: 'Drafting answer...',
  FORMULATING_SOURCES: 'Formulating sources...',
} as const;

