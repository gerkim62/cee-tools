import { Router, Request, Response } from 'express';
import { config } from '../config.js';
import { embedTexts, rerankChunks, chatCompletion } from '../services/openrouter.js';
import { queryPoints, buildSparseVector, QdrantQueryResult } from '../services/qdrant.js';
import { generateTextFragment } from '../services/chunker.js';
import { translateQuery } from '../services/queryTranslator.js';
import { ASK_SAKA_SYSTEM_PROMPT } from '../prompts.js';
import { SAKAHUB_CONSTANTS, RAG_CONSTANTS } from '../constants.js';

export const askRouter: Router = Router();

export interface Citation {
  articleId: string;
  articleTitle: string;
  articleNumber?: string;
  sectionHeading: string;
  quote: string;
  urlWithTextFragment: string;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
}

export interface AskRequestBody {
  question: string;
}

export interface CitedSourceItem {
  source_index: number;
  exact_quote: string;
}

export interface AskLlmStructuredOutput {
  answer: string;
  cited_sources: CitedSourceItem[];
}

/**
 * POST /ask
 * End-to-end RAG pipeline:
 * 1. Query Translation (Resolves slang, typos, brand nicknames via low-latency LLM)
 * 2. Multi-Variant Batch Dense Embeddings
 * 3. Parallel Hybrid Search in Qdrant (Dense + Sparse BM25 via native RRF)
 * 4. Candidate Union & Deduplication
 * 5. Article Flag Boosting (KeyUpdates / Featured guidelines)
 * 6. Cross-Encoder Reranking (Cohere v3.5 using translated primary query)
 * 7. Small-to-Big Context Assembly (parent sections with deduplication)
 * 8. Structured Answer Synthesis with Verified Text Fragment Citations
 */
askRouter.post('/ask', async (req: Request<{}, {}, AskRequestBody>, res: Response): Promise<void> => {
  const requestStart = Date.now();

  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    const trimmedQuestion = question.trim();
    console.log(`\n[Ask] 📥 New Query: "${trimmedQuestion}"`);

    // 1. Query Translation
    const transStart = Date.now();
    const translated = await translateQuery(trimmedQuestion);
    console.log(`[Ask:1/6] ✔ Query translated in ${Date.now() - transStart}ms:`);
    console.log(`   Primary  : "${translated.primary}"`);
    console.log(`   Fallback : "${translated.fallback}"`);
    if (translated.alt) {
      console.log(`   Alt      : "${translated.alt}"`);
    }

    const queryVariants = [translated.primary, translated.fallback];
    if (translated.alt) {
      queryVariants.push(translated.alt);
    }

    // 2. Generate embeddings for all query variants in a single batch
    const embedStart = Date.now();
    console.log(`[Ask:2/6] Generating embeddings for ${queryVariants.length} query variants via ${config.OPENROUTER_EMBED_MODEL}...`);
    const queryVectors = await embedTexts(queryVariants);
    if (!queryVectors || queryVectors.length === 0 || !queryVectors[0]) {
      console.error('[Ask:2/6] ❌ Failed to generate embeddings for query variants.');
      res.status(500).json({ error: 'Failed to generate embedding for query' });
      return;
    }
    console.log(`[Ask:2/6] ✔ Embeddings ready in ${Date.now() - embedStart}ms (dim: ${queryVectors[0].length})`);

    // 3. Parallel Hybrid Search in Qdrant (Dense + Sparse BM25 with RRF)
    const searchStart = Date.now();
    console.log(`[Ask:3/6] Hybrid search in Qdrant (candidate limit: ${config.RETRIEVAL_CANDIDATES})...`);

    const candidateSets = await Promise.all(
      queryVectors.map((denseVec, i) => {
        const variantText = queryVariants[i] || trimmedQuestion;
        const sparseVec = buildSparseVector(variantText);
        return queryPoints(denseVec, sparseVec, config.RETRIEVAL_CANDIDATES);
      })
    );

    // Union and deduplicate candidates by chunk ID
    const seenIds = new Set<string | number>();
    const candidates: QdrantQueryResult[] = [];
    for (const set of candidateSets) {
      for (const c of set) {
        if (!seenIds.has(c.id)) {
          seenIds.add(c.id);
          candidates.push(c);
        }
      }
    }
    const searchMs = Date.now() - searchStart;

    if (candidates.length === 0) {
      console.warn(`[Ask:3/6] ⚠️ No matching vectors found in Qdrant (${searchMs}ms).`);
      res.json({
        answer: 'No relevant articles or information found in the SakaHub knowledge base for this query.',
        citations: [],
      });
      return;
    }

    const topScore = candidates[0]?.score ?? 0;
    const lowScore = candidates[candidates.length - 1]?.score ?? 0;
    console.log(`[Ask:3/6] ✔ Retrieved and deduplicated ${candidates.length} candidates across ${queryVariants.length} variants in ${searchMs}ms (scores: ${topScore.toFixed(3)} down to ${lowScore.toFixed(3)})`);

    // 4. Apply article flag boost for KeyUpdates and Featured guidelines
    const boostedCandidates = candidates.map(c => {
      const flag = c.payload?.article_flag;
      if (flag && SAKAHUB_CONSTANTS.BOOSTED_FLAGS.includes(flag as any)) {
        return { ...c, score: c.score * config.ARTICLE_FLAG_BOOST };
      }
      return c;
    });
    boostedCandidates.sort((a, b) => b.score - a.score);

    // 5. Cross-encoder reranking using translated.primary (clean, semantically explicit)
    const rerankStart = Date.now();
    const candidateTexts = boostedCandidates.map(c => {
      const p = c.payload;
      const numPrefix = p?.article_number ? `[${p.article_number}] ` : '';
      const heading = p?.section_heading ? ` > ${p.section_heading}` : '';
      return `${numPrefix}${p?.article_title || ''}${heading}\n${p?.chunk_text || ''}`;
    });

    console.log(`[Ask:4/6] Cross-encoder reranking top candidates via ${config.OPENROUTER_RERANK_MODEL} (top ${config.RERANK_TOP_K})...`);
    const rerankedResults = await rerankChunks(
      translated.primary,
      candidateTexts,
      config.RERANK_TOP_K
    );

    // Pick top-ranked points
    const topChunks: QdrantQueryResult[] = rerankedResults
      .map(r => boostedCandidates[r.index])
      .filter((c): c is QdrantQueryResult => Boolean(c));

    const rerankMs = Date.now() - rerankStart;
    console.log(`[Ask:4/6] ✔ Pruned to ${topChunks.length} most relevant sources in ${rerankMs}ms:`);
    topChunks.forEach((c, idx) => {
      const p = c.payload;
      const score = rerankedResults[idx]?.relevanceScore ?? c.score ?? 0;
      console.log(`   #${idx + 1} [Rel: ${score.toFixed(3)}] [${p?.article_number || 'N/A'}] "${p?.article_title}" > "${p?.section_heading}"`);
    });

    // 6. Construct context for LLM synthesis (Small-to-Big: parent sections with deduplication)
    const seenParents = new Set<string>();
    const contextSources: {
      index: number;
      articleId: string;
      articleTitle: string;
      articleNumber?: string;
      articleFlag: string;
      sectionHeading: string;
      content: string;
      chunk: QdrantQueryResult;
    }[] = [];

    for (const chunk of topChunks) {
      const p = chunk.payload;
      const parentKey = `${p?.article_id || ''}::${p?.section_heading || ''}`;
      if (seenParents.has(parentKey)) {
        continue;
      }
      seenParents.add(parentKey);

      const content = p?.parent_text || p?.chunk_text || '';
      contextSources.push({
        index: contextSources.length + 1,
        articleId: p?.article_id || 'Unknown',
        articleTitle: p?.article_title || 'Untitled',
        articleNumber: p?.article_number || undefined,
        articleFlag: p?.article_flag || SAKAHUB_CONSTANTS.DEFAULT_ARTICLE_FLAG,
        sectionHeading: p?.section_heading || 'General',
        content,
        chunk,
      });
    }

    const contextBlocks = contextSources.map(s => {
      const numPrefix = s.articleNumber ? `[${s.articleNumber}] ` : '';
      return `[Source ${s.index}]
Article: ${numPrefix}${s.articleTitle}
Article ID: ${s.articleId}
Article Number: ${s.articleNumber || 'N/A'}
Article Flag: ${s.articleFlag}
Section: ${s.sectionHeading}
Content:
${s.content}
`;
    }).join('\n---\n\n');

    const userMessage = `Context Sources:\n${contextBlocks}\n\nQuestion: ${trimmedQuestion}`;

    const llmStart = Date.now();
    console.log(`[Ask:5/6] Synthesizing answer via ${config.OPENROUTER_CHAT_MODEL}...`);
    const llmRawResponse = await chatCompletion([
      { role: 'system', content: ASK_SAKA_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ], {
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
    });
    const llmMs = Date.now() - llmStart;
    console.log(`[Ask:5/6] ✔ Answer generated in ${llmMs}ms (raw response: ${llmRawResponse.length} chars)`);

    function parseAskOutput(raw: string): AskLlmStructuredOutput {
      let cleaned = raw.trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed: unknown = JSON.parse(jsonMatch[0]);
          if (typeof parsed === 'object' && parsed !== null && 'answer' in parsed) {
            const record = parsed as { answer?: unknown; cited_sources?: unknown };
            const answer = typeof record.answer === 'string' ? record.answer : raw;
            const cited_sources = Array.isArray(record.cited_sources) ? (record.cited_sources as CitedSourceItem[]) : [];
            return { answer, cited_sources };
          }
        } catch {}
      }

      return { answer: raw, cited_sources: [] };
    }

    const parsedOutput = parseAskOutput(llmRawResponse);
    const answerText = parsedOutput.answer;
    const citedList: CitedSourceItem[] = parsedOutput.cited_sources || [];

    // 7. Build structured citations with adaptive Chrome Text Fragments
    const citations: Citation[] = [];
    const seenQuotes = new Set<string>();

    for (const citationItem of citedList) {
      const sourceIndex = citationItem.source_index - 1;
      const source = contextSources[sourceIndex] || contextSources[0];
      if (!source) continue;

      const p = source.chunk.payload;
      const quote = citationItem.exact_quote || p?.chunk_text.slice(0, RAG_CONSTANTS.CITATIONS.MAX_PREVIEW_LENGTH) || source.content.slice(0, RAG_CONSTANTS.CITATIONS.MAX_PREVIEW_LENGTH);
      if (seenQuotes.has(quote)) continue;
      seenQuotes.add(quote);

      const fragment = generateTextFragment(quote);
      const urlWithTextFragment = `${config.SAKAHUB_BASE_URL}/app/article/${source.articleId}${fragment}`;

      citations.push({
        articleId: source.articleId,
        articleTitle: source.articleTitle,
        articleNumber: source.articleNumber,
        sectionHeading: source.sectionHeading,
        quote,
        urlWithTextFragment,
      });
    }

    // Fallback if model did not return structured cited_sources array
    if (citations.length === 0 && contextSources.length > 0) {
      for (const source of contextSources.slice(0, RAG_CONSTANTS.CITATIONS.FALLBACK_COUNT)) {
        const p = source.chunk.payload;
        const quote = p?.chunk_text.slice(0, RAG_CONSTANTS.CITATIONS.MAX_FALLBACK_QUOTE_LENGTH) || source.content.slice(0, RAG_CONSTANTS.CITATIONS.MAX_FALLBACK_QUOTE_LENGTH);
        const fragment = generateTextFragment(quote);
        citations.push({
          articleId: source.articleId,
          articleTitle: source.articleTitle,
          articleNumber: source.articleNumber,
          sectionHeading: source.sectionHeading,
          quote,
          urlWithTextFragment: `${config.SAKAHUB_BASE_URL}/app/article/${source.articleId}${fragment}`,
        });
      }
    }

    const totalMs = Date.now() - requestStart;
    console.log(`[Ask:6/6] ✔ Prepared ${citations.length} verified citations. Total pipeline latency: ${totalMs}ms`);
    citations.forEach((c, idx) => {
      console.log(`   Citation #${idx + 1} [${c.articleNumber || 'N/A'}] "${c.articleTitle}" > "${c.sectionHeading}"`);
      console.log(`   ↳ Highlight: ${c.urlWithTextFragment}`);
    });
    console.log(`[Ask] 🏁 Pipeline finished successfully.\n`);

    const responsePayload: AskResponse = {
      answer: answerText,
      citations,
    };

    res.json(responsePayload);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Ask Router Error] Error processing query:', error);
    res.status(500).json({ error: 'Failed to process question', message: msg });
  }
});
