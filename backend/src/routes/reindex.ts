import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { refreshLock } from '../services/lock.js';
import { splitArticle, ChunkResult } from '../services/chunker.js';
import { embedTexts, generateChunkContext } from '../services/openrouter.js';
import {
  deleteArticlePoints,
  deleteManyArticlesPoints,
  upsertPoints,
  QdrantChunkPoint,
} from '../services/qdrant.js';

export const reindexRouter: Router = Router();

export interface ChangedArticleInput {
  id: string;
  title: string;
  articleNumber?: string | null;
  markdownContent: string;
  lastUpdated: string;
  publishedAt?: string | null;
  articleFlag?: string | null;
}

export interface ReindexBatchPayload {
  changed?: ChangedArticleInput[];
  deletedIds?: string[];
  clientId?: string;
}

export interface ReindexArticleError {
  articleId: string;
  error: string;
}

export interface ReindexResponse {
  success: boolean;
  processedCount: number;
  deletedCount: number;
  failedCount: number;
  errors?: ReindexArticleError[];
  elapsedMs: number;
}

/**
 * Concurrency helper to limit parallel executions with strict typing
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * POST /reindex
 * Ingests a size-capped batch of changed articles and deleted article IDs.
 */
reindexRouter.post('/reindex', async (req: Request<{}, {}, ReindexBatchPayload>, res: Response): Promise<void> => {
  const startTime = Date.now();
  const payload = req.body;
  const changed = payload.changed || [];
  const deletedIds = payload.deletedIds || [];
  const clientId = payload.clientId;

  // 1. Auto-refresh sync lock timestamp on each arriving batch (+3 minutes)
  await refreshLock(clientId);

  const errors: ReindexArticleError[] = [];
  let processedCount = 0;
  let deletedCount = 0;

  try {
    // 2. Handle deleted articles
    if (deletedIds.length > 0) {
      console.log(`[Reindex] Processing ${deletedIds.length} deleted articles...`);
      await deleteManyArticlesPoints(deletedIds);
      await query(`DELETE FROM articles WHERE id = ANY($1::varchar[])`, [deletedIds]);
      deletedCount = deletedIds.length;
    }

    // 3. Process changed/added articles with per-article error isolation
    for (const article of changed) {
      try {
        if (!article.id || !article.title || !article.markdownContent) {
          throw new Error('Missing mandatory article fields (id, title, or markdownContent)');
        }

        // A. Delete existing vectors for this article before inserting updated chunks
        await deleteArticlePoints(article.id);

        // B. Hierarchical & recursive chunking
        const chunks: ChunkResult[] = await splitArticle({
          id: article.id,
          title: article.title,
          articleNumber: article.articleNumber || undefined,
          markdownContent: article.markdownContent,
          lastUpdated: article.lastUpdated,
        });

        if (chunks.length === 0) {
          console.warn(`[Reindex] No chunks produced for article ${article.id}`);
          await query(
            `INSERT INTO articles (id, article_number, title, last_updated, published_at, article_flag, indexed_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (id) DO UPDATE
             SET article_number = EXCLUDED.article_number,
                 title = EXCLUDED.title,
                 last_updated = EXCLUDED.last_updated,
                 published_at = EXCLUDED.published_at,
                 article_flag = EXCLUDED.article_flag,
                 indexed_at = NOW()`,
            [
              article.id,
              article.articleNumber || null,
              article.title,
              article.lastUpdated,
              article.publishedAt || null,
              article.articleFlag || 'Default',
            ]
          );
          processedCount++;
          continue;
        }

        // C. Anthropic Contextual Retrieval: Enrich each chunk with full-doc situational context
        const enrichedTexts = await mapConcurrent(chunks, 5, async (chunk) => {
          const context = await generateChunkContext(article.markdownContent, chunk.text);
          if (context) {
            return {
              embeddedText: `${context}\n\n${chunk.text}`,
              context,
            };
          }
          return {
            embeddedText: `${chunk.structuralPrefix}\n\n${chunk.text}`,
            context: null,
          };
        });

        // D. Generate vector embeddings in batch for all chunks of this article
        const textsToEmbed = enrichedTexts.map(e => e.embeddedText);
        const embeddings = await embedTexts(textsToEmbed);

        // E. Build Qdrant points payload
        const points: QdrantChunkPoint[] = chunks.map((chunk, idx) => ({
          id: crypto.randomUUID(),
          vector: embeddings[idx],
          payload: {
            article_id: article.id,
            article_title: article.title,
            article_number: article.articleNumber || null,
            article_flag: article.articleFlag || 'Default',
            section_heading: chunk.metadata.sectionHeading,
            chunk_index: chunk.metadata.chunkIndex,
            last_updated: article.lastUpdated,
            chunk_text: chunk.text,
            context_summary: enrichedTexts[idx].context,
            text_fragment: chunk.textFragment,
          },
        }));

        // F. Upsert chunks into Qdrant
        await upsertPoints(points);

        // G. Record updated article metadata in PostgreSQL
        await query(
          `INSERT INTO articles (id, article_number, title, last_updated, published_at, article_flag, indexed_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (id) DO UPDATE
           SET article_number = EXCLUDED.article_number,
               title = EXCLUDED.title,
               last_updated = EXCLUDED.last_updated,
               published_at = EXCLUDED.published_at,
               article_flag = EXCLUDED.article_flag,
               indexed_at = NOW()`,
          [
            article.id,
            article.articleNumber || null,
            article.title,
            article.lastUpdated,
            article.publishedAt || null,
            article.articleFlag || 'Default',
          ]
        );

        processedCount++;
      } catch (articleErr: unknown) {
        const errorMsg = articleErr instanceof Error ? articleErr.message : String(articleErr);
        console.error(`[Reindex Error] Failed processing article ${article.id}:`, articleErr);
        errors.push({
          articleId: article.id,
          error: errorMsg,
        });
      }
    }

    const elapsedMs = Date.now() - startTime;
    const responseData: ReindexResponse = {
      success: true,
      processedCount,
      deletedCount,
      failedCount: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      elapsedMs,
    };
    res.json(responseData);
  } catch (batchErr: unknown) {
    const errorMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
    console.error('[Reindex Error] Batch ingestion failure:', batchErr);
    res.status(500).json({
      success: false,
      error: 'Batch ingestion failed',
      message: errorMsg,
    });
  }
});
