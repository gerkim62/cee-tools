import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config.js';
import { probeEmbeddingDimension } from './openrouter.js';

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
  context_summary: string | null;
  text_fragment: string;
}

export interface QdrantChunkPoint {
  id: string;
  vector: number[];
  payload: SakaChunkPayload;
}

export interface QdrantQueryResult {
  id: string | number;
  score: number;
  payload?: SakaChunkPayload;
}

export async function initQdrant(): Promise<string> {
  // 1. Probe dimension of currently configured embedding model
  let vectorSize = 1536;
  try {
    vectorSize = await probeEmbeddingDimension();
  } catch (err) {
    console.warn('[Qdrant] Could not probe dimension from OpenRouter, defaulting to 1536:', err);
  }

  // 2. Generate model-scoped collection name so switching models never crashes Qdrant
  activeCollectionName = getModelCollectionName(config.QDRANT_COLLECTION_BASE, config.OPENROUTER_EMBED_MODEL);

  try {
    // 3. Ensure collection exists
    const collectionsRes = await qdrantClient.getCollections();
    const exists = collectionsRes.collections.some(c => c.name === activeCollectionName);

    if (!exists) {
      console.log(`[Qdrant] Creating collection ${activeCollectionName} with vector size ${vectorSize}...`);
      await qdrantClient.createCollection(activeCollectionName, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      });
      console.log(`[Qdrant] Collection ${activeCollectionName} created successfully.`);
    } else {
      console.log(`[Qdrant] Collection ${activeCollectionName} already exists.`);
    }

    // 4. Ensure payload index on article_id for instant O(1) filtered deletions
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
  } catch (error) {
    console.error(`[Qdrant Error] Failed to initialize Qdrant collection ${activeCollectionName}:`, error);
    throw error;
  }
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

export async function queryPoints(
  vector: number[],
  limit: number
): Promise<QdrantQueryResult[]> {
  const result = await qdrantClient.query(activeCollectionName, {
    query: vector,
    limit,
    with_payload: true,
  });

  return (result.points || []).map((p: any) => ({
    id: p.id,
    score: p.score,
    payload: p.payload as SakaChunkPayload | undefined,
  }));
}
