import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import { embedTexts, rerankChunks, chatCompletionStream } from '../services/openrouter.js';
import { queryPoints, buildSparseVector, QdrantQueryResult } from '../services/qdrant.js';
import { generateTextFragment } from '../services/chunker.js';
import { translateQuery } from '../services/queryTranslator.js';
import { ASK_SAKA_SYSTEM_PROMPT } from '../prompts.js';
import { SAKAHUB_CONSTANTS, RAG_CONSTANTS, CEE_STATUS_MESSAGES } from '../constants.js';

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
  conversationId?: string;
}

export interface AskRequestBody {
  question: string;
  conversationId?: string;
  clientId?: string;
  stream?: boolean;
}

/**
 * POST /ask
 * End-to-end RAG pipeline with real-time SSE streaming:
 * 1. Understanding request... (Query translation & shorthand expansion)
 * 2. Searching SakaHub... (Parallel dense + sparse BM25 retrieval with RRF)
 * 3. Reviewing procedures... (Flag boost, cross-encoder rerank & small-to-big context assembly)
 * 4. Drafting answer... (Real-time OpenRouter token streaming)
 * 5. Formulating sources... (Inline citation extraction with Chrome Text Fragments)
 */
askRouter.post('/ask', async (req: Request<{}, {}, AskRequestBody>, res: Response): Promise<void> => {
  const requestStart = Date.now();
  const isStream =
    (req.headers.accept && req.headers.accept.includes('text/event-stream')) ||
    req.query.stream === 'true' ||
    req.body.stream === true;

  if (isStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    (res as any).flushHeaders?.();
  }

  const sendEvent = (event: string, data: unknown) => {
    if (!isStream || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { question, conversationId, clientId } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      if (isStream) {
        sendEvent('error', { message: 'Question is required' });
        res.end();
      } else {
        res.status(400).json({ error: 'Question is required' });
      }
      return;
    }

    const trimmedQuestion = question.trim();
    console.log(`\n[Ask] 📥 New Query: "${trimmedQuestion}" (streaming: ${isStream}, convId: ${conversationId || 'none'})`);

    // Manage conversation thread and history
    let activeConversationId: string | null = conversationId || null;
    let previousTurnsContext = '';

    if (clientId || conversationId) {
      try {
        if (activeConversationId) {
          const convCheck = await query(`SELECT id FROM conversations WHERE id = $1`, [activeConversationId]);
          if (convCheck.rows.length === 0 && clientId) {
            await query(
              `INSERT INTO conversations (id, client_id, title, created_at, updated_at)
               VALUES ($1, $2, $3, NOW(), NOW())`,
              [activeConversationId, clientId, trimmedQuestion.slice(0, 60)]
            );
          }
        } else if (clientId) {
          activeConversationId = crypto.randomUUID();
          await query(
            `INSERT INTO conversations (id, client_id, title, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())`,
            [activeConversationId, clientId, trimmedQuestion.slice(0, 60)]
          );
        }

        if (activeConversationId) {
          // Record incoming user message
          await query(
            `INSERT INTO messages (id, conversation_id, role, content, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [crypto.randomUUID(), activeConversationId, 'user', trimmedQuestion]
          );

          // Fetch recent previous turns for context continuity (excluding the turn just inserted)
          const pastMessagesRes = await query(
            `SELECT role, content FROM messages
             WHERE conversation_id = $1 AND role IN ('user', 'assistant')
             ORDER BY created_at DESC
             OFFSET 1 LIMIT 4`,
            [activeConversationId]
          );

          if (pastMessagesRes.rows.length > 0) {
            const chronological = pastMessagesRes.rows.reverse();
            previousTurnsContext = chronological
              .map((m) => `${m.role === 'user' ? 'CEE Agent' : 'Ask Saka'}: ${m.content.slice(0, 400)}`)
              .join('\n');
          }
        }
      } catch (convErr) {
        console.warn('[Ask] Failed managing conversation state in DB:', convErr);
      }
    }

    // 1. Understanding request...
    sendEvent('status', { message: CEE_STATUS_MESSAGES.UNDERSTANDING });
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

    // 2. Searching SakaHub...
    sendEvent('status', { message: CEE_STATUS_MESSAGES.SEARCHING });
    const embedStart = Date.now();
    console.log(`[Ask:2/6] Generating embeddings for ${queryVariants.length} query variants via ${config.OPENROUTER_EMBED_MODEL}...`);
    const queryVectors = await embedTexts(queryVariants);
    if (!queryVectors || queryVectors.length === 0 || !queryVectors[0]) {
      console.error('[Ask:2/6] ❌ Failed to generate embeddings for query variants.');
      if (isStream) {
        sendEvent('error', { message: 'Failed to generate embedding for query' });
        res.end();
      } else {
        res.status(500).json({ error: 'Failed to generate embedding for query' });
      }
      return;
    }
    console.log(`[Ask:2/6] ✔ Embeddings ready in ${Date.now() - embedStart}ms (dim: ${queryVectors[0].length})`);

    // Hybrid search in parallel across all variants
    const searchStart = Date.now();
    console.log(`[Ask:3/6] Hybrid search in Qdrant (candidate limit: ${config.RETRIEVAL_CANDIDATES})...`);
    const searchResults = await Promise.all(
      queryVariants.map((variantText, idx) => {
        const denseVec = queryVectors[idx];
        const sparseVec = buildSparseVector(variantText);
        return queryPoints(denseVec, sparseVec, config.RETRIEVAL_CANDIDATES);
      })
    );

    const candidates: QdrantQueryResult[] = [];
    const seenIds = new Set<string | number>();

    for (const points of searchResults) {
      for (const p of points) {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          candidates.push(p);
        }
      }
    }
    const searchMs = Date.now() - searchStart;

    if (candidates.length === 0) {
      console.warn(`[Ask:3/6] ⚠️ No matching vectors found in Qdrant (${searchMs}ms).`);
      const emptyPayload: AskResponse = {
        answer: 'No relevant articles or information found in the SakaHub knowledge base for this query.',
        citations: [],
      };
      if (isStream) {
        sendEvent('done', emptyPayload);
        res.end();
      } else {
        res.json(emptyPayload);
      }
      return;
    }

    const topScore = candidates[0]?.score ?? 0;
    const lowScore = candidates[candidates.length - 1]?.score ?? 0;
    console.log(`[Ask:3/6] ✔ Retrieved and deduplicated ${candidates.length} candidates across ${queryVariants.length} variants in ${searchMs}ms (scores: ${topScore.toFixed(3)} down to ${lowScore.toFixed(3)})`);

    // 3. Reviewing procedures...
    sendEvent('status', { message: CEE_STATUS_MESSAGES.REVIEWING });

    // Apply article flag boost for KeyUpdates and Featured guidelines
    const boostedCandidates = candidates.map(c => {
      const flag = c.payload?.article_flag;
      if (flag && SAKAHUB_CONSTANTS.BOOSTED_FLAGS.includes(flag as any)) {
        return { ...c, score: c.score * config.ARTICLE_FLAG_BOOST };
      }
      return c;
    });
    boostedCandidates.sort((a, b) => b.score - a.score);

    // Cross-encoder reranking using translated.primary (clean, semantically explicit)
    const rerankStart = Date.now();
    const candidateTexts = boostedCandidates.map(c => {
      const p = c.payload;
      const numPrefix = p?.article_number ? `[${p.article_number}] ` : '';
      const heading = p?.section_heading ? ` > ${p.section_heading}` : '';
      return `${numPrefix}${p?.article_title || ''}${heading}\n${p?.chunk_text || ''}`;
    });

    const rerankedIndices = await rerankChunks(
      translated.primary,
      candidateTexts,
      config.RERANK_TOP_K
    );
    const rerankMs = Date.now() - rerankStart;

    let selectedCandidates: QdrantQueryResult[] = [];
    if (rerankedIndices && rerankedIndices.length > 0) {
      selectedCandidates = rerankedIndices.map(r => boostedCandidates[r.index]).filter((c): c is QdrantQueryResult => !!c);
      console.log(`[Ask:4/6] ✔ Pruned to ${selectedCandidates.length} most relevant sources in ${rerankMs}ms:`);
      rerankedIndices.slice(0, 3).forEach((r, rankIdx) => {
        const p = boostedCandidates[r.index]?.payload;
        console.log(`   #${rankIdx + 1} [Rel: ${r.relevanceScore.toFixed(3)}] [${p?.article_number || 'N/A'}] "${p?.article_title}" > "${p?.section_heading}"`);
      });
    } else {
      selectedCandidates = boostedCandidates.slice(0, config.RERANK_TOP_K);
      console.log(`[Ask:4/6] ⚠️ Reranker returned empty, fallback to top ${selectedCandidates.length} vector candidates.`);
    }

    // Assemble context using full parent sections with section deduplication
    const seenParents = new Set<string>();
    const contextSources: Array<{
      index: number;
      articleId: string;
      articleTitle: string;
      articleNumber?: string;
      articleFlag: string;
      sectionHeading: string;
      content: string;
      chunk: QdrantQueryResult;
    }> = [];

    for (const candidate of selectedCandidates) {
      const p = candidate.payload;
      const parentKey = `${p?.article_id}::${p?.section_heading}`;
      const content = p?.parent_text || p?.chunk_text || '';

      if (seenParents.has(parentKey)) {
        continue;
      }
      seenParents.add(parentKey);

      contextSources.push({
        index: contextSources.length + 1,
        articleId: p?.article_id || 'Unknown',
        articleTitle: p?.article_title || 'Untitled',
        articleNumber: p?.article_number || undefined,
        articleFlag: p?.article_flag || SAKAHUB_CONSTANTS.DEFAULT_ARTICLE_FLAG,
        sectionHeading: p?.section_heading || 'General',
        content,
        chunk: candidate,
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

    const historyBlock = previousTurnsContext
      ? `Previous Conversation Context (for continuity):\n${previousTurnsContext}\n\n`
      : '';
    const userMessage = `${historyBlock}Context Sources from SakaHub:\n${contextBlocks}\n\nCEE Agent Question (Customer on live call): ${trimmedQuestion}\n\nProvide the immediate action checklist for the CEE agent:`;

    // 4. Drafting answer... (Real streaming token-by-token from OpenRouter)
    sendEvent('status', { message: CEE_STATUS_MESSAGES.DRAFTING });
    const llmStart = Date.now();
    console.log(`[Ask:5/6] Streaming answer via ${config.OPENROUTER_CHAT_MODEL}...`);

    let answerText = '';
    for await (const token of chatCompletionStream([
      { role: 'system', content: ASK_SAKA_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ])) {
      answerText += token;
      if (isStream) {
        sendEvent('token', { delta: token });
      }
    }
    const llmMs = Date.now() - llmStart;
    console.log(`[Ask:5/6] ✔ Answer stream finished in ${llmMs}ms (${answerText.length} chars)`);

    // 5. Formulating sources... (Build verified Chrome Text Fragment citations)
    sendEvent('status', { message: CEE_STATUS_MESSAGES.FORMULATING_SOURCES });

    const citations: Citation[] = [];
    const seenQuotes = new Set<string>();

    // Detect inline source references like [1], [2] in answer text
    const matches = [...answerText.matchAll(/\[(\d+)\]/g)];
    const citedIndices = [...new Set(matches.map(m => parseInt(m[1], 10)))];

    for (const srcIdx of citedIndices) {
      const source = contextSources.find(s => s.index === srcIdx);
      if (!source) continue;

      const p = source.chunk.payload;
      const quote = p?.chunk_text.slice(0, RAG_CONSTANTS.CITATIONS.MAX_PREVIEW_LENGTH) || source.content.slice(0, RAG_CONSTANTS.CITATIONS.MAX_PREVIEW_LENGTH);
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

    // Fallback if model did not include [X] brackets
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

    // Save assistant message to conversation history in DB
    if (activeConversationId) {
      try {
        await query(
          `INSERT INTO messages (id, conversation_id, role, content, citations, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [crypto.randomUUID(), activeConversationId, 'assistant', answerText, JSON.stringify(citations)]
        );
        await query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [activeConversationId]
        );
      } catch (saveErr) {
        console.warn('[Ask] Failed saving assistant turn to DB:', saveErr);
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
      conversationId: activeConversationId || undefined,
    };

    if (isStream) {
      sendEvent('citations', { citations });
      sendEvent('done', responsePayload);
      res.end();
    } else {
      res.json(responsePayload);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Ask Router Error] Error processing query:', error);
    if (isStream) {
      sendEvent('error', { message: msg });
      res.end();
    } else {
      res.status(500).json({ error: 'Failed to process question', message: msg });
    }
  }
});
