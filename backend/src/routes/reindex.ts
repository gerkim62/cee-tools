import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { config } from '../config.js';
import { refreshLock } from '../services/lock.js';
import { SAKAHUB_CONSTANTS, OPENROUTER_CONSTANTS } from '../constants.js';
import { splitArticle, ChunkResult } from '../services/chunker.js';
import { embedTexts, generateChunkContext } from '../services/openrouter.js';
import {
  deleteArticlePoints,
  deleteManyArticlesPoints,
  upsertPoints,
  QdrantChunkPoint,
  buildSparseVector,
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

  console.log(`\n[Reindex] 📦 Batch Received from client "${clientId || 'anon'}": ${changed.length} articles to index, ${deletedIds.length} deletions.`);

  // 1. Auto-refresh sync lock timestamp on each arriving batch (+3 minutes)
  await refreshLock(clientId);

  const errors: ReindexArticleError[] = [];
  let processedCount = 0;
  let deletedCount = 0;

  try {
    // 2. Handle deleted articles
    if (deletedIds.length > 0) {
      console.log(`[Reindex:Deletions] Processing ${deletedIds.length} deleted articles...`);
      await deleteManyArticlesPoints(deletedIds);
      await query(`DELETE FROM articles WHERE id = ANY($1::varchar[])`, [deletedIds]);
      deletedCount = deletedIds.length;
      console.log(`[Reindex:Deletions] ✔ Removed ${deletedCount} deleted articles from Qdrant and PostgreSQL.`);
    }

    // 3. Process changed/added articles with per-article error isolation
    for (let i = 0; i < changed.length; i++) {
      const article = changed[i];
      if (!article) {
        continue;
      }
      const artStart = Date.now();
      const artIndexLabel = `[Reindex:Article ${i + 1}/${changed.length}]`;

      try {
        if (!article.id || !article.title || !article.markdownContent) {
          throw new Error('Missing mandatory article fields (id, title, or markdownContent)');
        }

        console.log(`${artIndexLabel} 📄 [${article.articleNumber || 'N/A'}] "${article.title}" (id: ${article.id}, size: ${article.markdownContent.length} chars)`);

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
          console.warn(`${artIndexLabel} ⚠️ No chunks produced for article ${article.id}`);
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
              article.articleFlag || SAKAHUB_CONSTANTS.DEFAULT_ARTICLE_FLAG,
            ]
          );
          processedCount++;
          continue;
        }

        const uniqueSections = [...new Set(chunks.map(c => c.metadata.sectionHeading))];
        console.log(`${artIndexLabel} ✂️ Split into ${chunks.length} chunks across section(s): [${uniqueSections.join(', ')}]`);

        // C. Anthropic Contextual Retrieval: Enrich each chunk with full-doc situational context
        const enrichStart = Date.now();
        console.log(`${artIndexLabel} 🧠 Enriching ${chunks.length} chunks via ${config.OPENROUTER_CONTEXT_MODEL}...`);
        const enrichedTexts = await mapConcurrent(chunks, OPENROUTER_CONSTANTS.CONTEXTUAL_ENRICHMENT.CONCURRENCY, async (chunk) => {
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
        const enrichMs = Date.now() - enrichStart;
        console.log(`${artIndexLabel} ✔ Contextual enrichment completed in ${enrichMs}ms.`);

        // D. Generate vector embeddings in batch for all chunks of this article
        const embedStart = Date.now();
        const textsToEmbed = enrichedTexts.map(e => e.embeddedText);
        console.log(`${artIndexLabel} 📐 Generating ${textsToEmbed.length} vector embeddings via ${config.OPENROUTER_EMBED_MODEL}...`);
        const embeddings = await embedTexts(textsToEmbed);
        const embedMs = Date.now() - embedStart;
        console.log(`${artIndexLabel} ✔ Embeddings generated in ${embedMs}ms.`);

        // E. Build Qdrant points payload
        const points: QdrantChunkPoint[] = chunks.map((chunk, idx) => ({
          id: crypto.randomUUID(),
          vector: {
            dense: embeddings[idx],
            sparse: buildSparseVector(enrichedTexts[idx].embeddedText),
          },
          payload: {
            article_id: article.id,
            article_title: article.title,
            article_number: article.articleNumber || null,
            article_flag: article.articleFlag || 'Default',
            section_heading: chunk.metadata.sectionHeading,
            chunk_index: chunk.metadata.chunkIndex,
            last_updated: article.lastUpdated,
            chunk_text: chunk.text,
            parent_text: chunk.parentText,
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
            article.articleFlag || SAKAHUB_CONSTANTS.DEFAULT_ARTICLE_FLAG,
          ]
        );

        const artTotalMs = Date.now() - artStart;
        console.log(`${artIndexLabel} ✔ Successfully indexed in Qdrant & PostgreSQL in ${artTotalMs}ms.`);
        processedCount++;
      } catch (articleErr: unknown) {
        const errorMsg = articleErr instanceof Error ? articleErr.message : String(articleErr);
        console.error(`${artIndexLabel} ❌ Failed processing article ${article.id}:`, articleErr);
        errors.push({
          articleId: article.id,
          error: errorMsg,
        });
      }
    }

    const elapsedMs = Date.now() - startTime;
    console.log(`[Reindex] 🏁 Batch complete: ${processedCount} succeeded, ${errors.length} failed in ${elapsedMs}ms.\n`);

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
    console.error('[Reindex Error] ❌ Fatal batch ingestion failure:', batchErr);
    res.status(500).json({
      success: false,
      error: 'Batch ingestion failed',
      message: errorMsg,
    });
  }
});
