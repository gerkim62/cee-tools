import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config.js';
import { probeEmbeddingDimension } from './openrouter.js';
import { RAG_CONSTANTS } from '../constants.js';

export const qdrantClient = new QdrantClient({
  url: config.QDRANT_URL,
  apiKey: config.QDRANT_API_KEY,
});

let activeCollectionName: string = config.QDRANT_COLLECTION_BASE;

export function getActiveCollectionName(): string {
  return activeCollectionName;
}

export function getModelCollectionName(baseName: string, modelName: string): string {
  const sanitizedModel = modelName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `${baseName}_${sanitizedModel}`;
}

export interface SakaChunkPayload {
  [key: string]: unknown;
  article_id: string;
  article_title: string;
  article_number: string | null;
  article_flag?: string | null;
  section_heading: string;
  chunk_index: number;
  last_updated: string;
  chunk_text: string;
  parent_text?: string | null;
  context_summary: string | null;
  text_fragment: string;
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface QdrantChunkPoint {
  id: string;
  vector: {
    dense: number[];
    sparse: SparseVector;
  };
  payload: SakaChunkPayload;
}

export interface QdrantQueryResult {
  id: string | number;
  score: number;
  payload?: SakaChunkPayload;
}

function hashToken(token: string): number {
  let h = 0;
  for (let i = 0; i < token.length; i++) {
    h = (Math.imul(31, h) + token.charCodeAt(i)) >>> 0;
  }
  return (h % RAG_CONSTANTS.SPARSE_VOCABULARY_SIZE) + 1;
}

/**
 * Builds a deterministic sparse TF vector for exact keyword/code matching in Qdrant BM25.
 * Captures alphanumeric terms, USSD codes (*334#), and procedural error codes (LPPP-0014).
 */
export function buildSparseVector(text: string): SparseVector {
  const tokens = (text.toLowerCase().match(/[*#a-z0-9_-]+/g) || [])
    .map(t => t.trim())
    .filter(t => t.length >= 1);

  if (tokens.length === 0) {
    return { indices: [1], values: [0.001] };
  }

  const tf: Record<number, number> = {};
  for (const token of tokens) {
    const id = hashToken(token);
    tf[id] = (tf[id] || 0) + 1;
  }

  const total = tokens.length;
  // Sort indices ascending as required by Qdrant sparse vectors
  const indices = Object.keys(tf).map(Number).sort((a, b) => a - b);
  const values = indices.map(i => tf[i]! / total);

  return { indices, values };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = RAG_CONSTANTS.NETWORK_RETRY.MAX_RETRIES,
  delayMs = RAG_CONSTANTS.NETWORK_RETRY.INITIAL_DELAY_MS
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) {
        console.warn(`[Qdrant] Network warning (attempt ${i + 1}/${retries}), retrying in ${delayMs * (i + 1)}ms...`);
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

export async function initQdrant(): Promise<string> {
  // 1. Probe dimension of currently configured embedding model
  let vectorSize: number = RAG_CONSTANTS.FALLBACK_EMBEDDING_DIMENSION;
  try {
    vectorSize = await probeEmbeddingDimension();
  } catch (err) {
    console.warn(`[Qdrant] Could not probe dimension from OpenRouter, defaulting to ${RAG_CONSTANTS.FALLBACK_EMBEDDING_DIMENSION}:`, err);
  }

  // 2. Generate model-scoped collection name
  activeCollectionName = getModelCollectionName(config.QDRANT_COLLECTION_BASE, config.OPENROUTER_EMBED_MODEL);

  return withRetry(async () => {
    // 3. Ensure collection exists with named vectors (dense + sparse)
    const collectionsRes = await qdrantClient.getCollections();
    const existing = collectionsRes.collections.find(c => c.name === activeCollectionName);

    if (existing) {
      try {
        const info = await qdrantClient.getCollection(activeCollectionName);
        const hasSparse = !!info.config?.params?.sparse_vectors;
        const hasDenseNamed = !!(info.config?.params?.vectors as any)?.dense;

        if (!hasSparse || !hasDenseNamed) {
          console.log(`[Qdrant] Upgrading collection ${activeCollectionName} to hybrid (dense + sparse)...`);
          await qdrantClient.deleteCollection(activeCollectionName);
        }
      } catch (err) {
        console.warn(`[Qdrant] Error checking collection params, recreating:`, err);
        await qdrantClient.deleteCollection(activeCollectionName).catch(() => {});
      }
    }

    const checkAgain = await qdrantClient.getCollections();
    const stillExists = checkAgain.collections.some(c => c.name === activeCollectionName);

    if (!stillExists) {
      console.log(`[Qdrant] Creating hybrid collection ${activeCollectionName} (dense: ${vectorSize}, sparse: BM25)...`);
      await qdrantClient.createCollection(activeCollectionName, {
        vectors: {
          dense: {
            size: vectorSize,
            distance: 'Cosine',
          },
        },
        sparse_vectors: {
          sparse: {},
        },
      });
      console.log(`[Qdrant] Hybrid collection ${activeCollectionName} created successfully.`);
    } else {
      console.log(`[Qdrant] Hybrid collection ${activeCollectionName} verified ready.`);
    }

    // 4. Ensure payload index on article_id for instant filtered deletions
    try {
      await qdrantClient.createPayloadIndex(activeCollectionName, {
        field_name: 'article_id',
        field_schema: 'keyword',
      });
      console.log(`[Qdrant] Payload index on article_id verified.`);
    } catch (indexErr: unknown) {
      const msg = indexErr instanceof Error ? indexErr.message : String(indexErr);
      if (!msg.includes('already exists')) {
        console.warn(`[Qdrant] Payload index note:`, msg);
      }
    }

    return activeCollectionName;
  });
}

export async function deleteArticlePoints(articleId: string): Promise<void> {
  await qdrantClient.delete(activeCollectionName, {
    wait: true,
    filter: {
      must: [
        {
          key: 'article_id',
          match: { value: articleId },
        },
      ],
    },
  });
}

export async function deleteManyArticlesPoints(articleIds: string[]): Promise<void> {
  if (articleIds.length === 0) return;
  await qdrantClient.delete(activeCollectionName, {
    wait: true,
    filter: {
      must: [
        {
          key: 'article_id',
          match: { any: articleIds },
        },
      ],
    },
  });
}

export async function upsertPoints(points: QdrantChunkPoint[]): Promise<void> {
  if (points.length === 0) return;
  await qdrantClient.upsert(activeCollectionName, {
    wait: true,
    points,
  });
}

/**
 * Executes hybrid search using Qdrant native prefetch + RRF (Reciprocal Rank Fusion)
 */
export async function queryPoints(
  denseVector: number[],
  sparseVector: SparseVector,
  limit: number
): Promise<QdrantQueryResult[]> {
  return withRetry(async () => {
    const prefetchLimit = limit * RAG_CONSTANTS.PREFETCH_CANDIDATE_MULTIPLIER;
    const result = await qdrantClient.query(activeCollectionName, {
      prefetch: [
        { query: denseVector, using: 'dense', limit: prefetchLimit },
        { query: { indices: sparseVector.indices, values: sparseVector.values }, using: 'sparse', limit: prefetchLimit },
      ],
      query: { fusion: 'rrf' },
      limit,
      with_payload: true,
    });

    return (result.points || []).map((p: any) => ({
      id: p.id,
      score: p.score,
      payload: p.payload as SakaChunkPayload | undefined,
    }));
  });
}

