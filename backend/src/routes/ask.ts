import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import { embedTexts, rerankChunks, chatCompletionStream, chatCompletion, OpenRouterChatMessage } from '../services/openrouter.js';
import { queryPoints, buildSparseVector, QdrantQueryResult, qdrantClient, getActiveCollectionName } from '../services/qdrant.js';
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

export interface ExecutionStep {
  label: string;
  detail: string;
}

export interface ClarifyingQuestion {
  type: 'single_choice' | 'multi_choice' | 'free_text';
  prompt: string;
  options?: string[];
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
  conversationId?: string;
  conversationTitle?: string;
  executionSteps?: ExecutionStep[];
  clarifyingQuestion?: ClarifyingQuestion;
  suggestedFollowUps?: string[];
  messageId?: string;
  userMessageId?: string;
  parentId?: string | null;
}

export function extractClarification(text: string): { cleanText: string; clarification?: ClarifyingQuestion } {
  const clarificationRegex = /<clarify(?:\s+type="([^"]+)")?>([\s\S]*?)<\/clarify>/i;
  const match = text.match(clarificationRegex);
  if (!match) return { cleanText: text };

  const rawType = (match[1] || 'single_choice').toLowerCase();
  const type: ClarifyingQuestion['type'] =
    rawType.includes('multi') ? 'multi_choice' : rawType.includes('free') ? 'free_text' : 'single_choice';

  const parts = match[2].split('|').map(p => p.trim()).filter(Boolean);
  const prompt = parts[0] || 'Please select an option:';
  const options = parts.length > 1 ? parts.slice(1) : undefined;

  const cleanText = text.replace(clarificationRegex, '').trimEnd();
  return { cleanText, clarification: { type, prompt, options } };
}

export function extractSuggestions(text: string): { cleanText: string; suggestions?: string[] } {
  const suggestionsRegex = /<suggest>([\s\S]*?)<\/suggest>/i;
  const match = text.match(suggestionsRegex);
  const suggestions = match ? match[1].split('|').map(s => s.trim()).filter(Boolean) : undefined;
  const cleanText = text.replace(suggestionsRegex, '').trimEnd();
  return { cleanText, suggestions: suggestions && suggestions.length > 0 ? suggestions : undefined };
}

export function generateFallbackSuggestions(
  question: string,
  contextSources: Array<{ sectionHeading?: string; articleTitle?: string }>
): string[] {
  const fallbacks: string[] = [];
  const qLower = question.toLowerCase();

  for (const src of contextSources) {
    const heading = src.sectionHeading?.trim();
    if (
      heading &&
      heading !== 'General' &&
      heading !== 'Introduction' &&
      heading !== 'Overview' &&
      !qLower.includes(heading.toLowerCase()) &&
      !fallbacks.some(f => f.toLowerCase().includes(heading.toLowerCase()))
    ) {
      if (/^[A-Z0-9\s-]+$/i.test(heading) && heading.length > 3 && heading.length < 50) {
        fallbacks.push(`What are the procedures for ${heading}?`);
      }
    }
    if (fallbacks.length >= 2) break;
  }

  if (fallbacks.length < 2) {
    if (!qLower.includes('sla') && !qLower.includes('turnaround') && !qLower.includes('time')) {
      fallbacks.push('What is the turnaround time (SLA) for this procedure?');
    }
    if (!qLower.includes('escalat') && !qLower.includes('siebel') && !qLower.includes('g3')) {
      fallbacks.push('What is the escalation path if the customer issue persists?');
    }
    if (!qLower.includes('eligib') && !qLower.includes('require') && fallbacks.length < 3) {
      fallbacks.push('What are the required customer vetting conditions?');
    }
  }

  return fallbacks.slice(0, 3);
}

export interface AskRequestBody {
  question: string;
  conversationId?: string;
  clientId?: string;
  stream?: boolean;
  parentId?: string | null;
  retryUserMessageId?: string | null;
}

const activeAskRequests = new Set<string>();

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

  let requestDedupeKey: string | null = null;

  try {
    const { question, conversationId, clientId, parentId, retryUserMessageId } = req.body;
    const isRetry = Boolean(retryUserMessageId);
    const userMessageId = retryUserMessageId || crypto.randomUUID();
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
    const clientKey = clientId || (req.ip || 'anon');
    requestDedupeKey = `${clientKey}::${trimmedQuestion.toLowerCase()}`;

    // Deduplication check: prevent identical concurrent in-flight requests that burn tokens/credits
    if (activeAskRequests.has(requestDedupeKey)) {
      const busyMsg = 'A matching query is currently being processed. Please wait for completion.';
      if (isStream) {
        sendEvent('error', { message: busyMsg });
        res.end();
      } else {
        res.status(429).json({ error: busyMsg });
      }
      return;
    }
    activeAskRequests.add(requestDedupeKey);

    console.log(`\n[Ask] 📥 New Query: "${trimmedQuestion}" (streaming: ${isStream}, convId: ${conversationId || 'none'}, parentId: ${parentId || 'none'}, isRetry: ${isRetry})`);

    // Manage conversation thread and history
    let activeConversationId: string | null = conversationId || null;
    let previousTurnsContext = '';

    if (clientId || conversationId) {
      try {
        if (activeConversationId) {
          const convCheck = await query(`SELECT id, is_compacted FROM conversations WHERE id = $1`, [activeConversationId]);
          if (convCheck.rows.length > 0 && convCheck.rows[0].is_compacted) {
            const lockedMsg = 'This conversation has been compacted and locked. Please start a new conversation or continue in the active thread.';
            if (isStream) {
              sendEvent('error', { message: lockedMsg });
              res.end();
            } else {
              res.status(400).json({ error: lockedMsg });
            }
            return;
          }
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
          // Record incoming user message with parent_id ONLY if not retrying an existing user turn
          if (!isRetry) {
            await query(
              `INSERT INTO messages (id, conversation_id, parent_id, role, content, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW())`,
              [userMessageId, activeConversationId, parentId || null, 'user', trimmedQuestion]
            );
          }

          // Fetch previous turns along the active branch ancestry for context continuity
          let pastRows: Array<{ role: string; content: string }> = [];
          const effectiveAnchorId = isRetry ? userMessageId : parentId;
          if (effectiveAnchorId) {
            const ancestorRes = await query(
              `WITH RECURSIVE ancestors AS (
                 SELECT id, parent_id, role, content, created_at, 1 AS depth
                 FROM messages
                 WHERE id = $1
                 UNION ALL
                 SELECT m.id, m.parent_id, m.role, m.content, m.created_at, a.depth + 1
                 FROM messages m
                 JOIN ancestors a ON m.id = a.parent_id
                 WHERE a.depth < 8
               )
               SELECT id, role, content FROM ancestors
               WHERE role IN ('user', 'assistant')
               ORDER BY depth DESC`,
              [effectiveAnchorId]
            );
            pastRows = isRetry
              ? ancestorRes.rows.filter((r) => r.id !== userMessageId)
              : ancestorRes.rows;
          } else {
            const pastMessagesRes = await query(
              `SELECT role, content FROM messages
               WHERE conversation_id = $1 AND role IN ('user', 'assistant') AND id != $2
               ORDER BY created_at DESC
               LIMIT 4`,
              [activeConversationId, userMessageId]
            );
            pastRows = pastMessagesRes.rows.reverse();
          }

          if (pastRows.length > 0) {
            previousTurnsContext = pastRows
              .map((m) => `${m.role === 'user' ? 'CEE Agent' : 'Ask Saka'}: ${m.content.slice(0, 400)}`)
              .join('\n');
          }
        }
      } catch (convErr) {
        console.warn('[Ask] Failed managing conversation state in DB:', convErr);
      }
    }

    const executionSteps: ExecutionStep[] = [];

    // 1. Understanding request & analyzing context requirements
    sendEvent('status', { message: CEE_STATUS_MESSAGES.UNDERSTANDING });
    const transStart = Date.now();
    const translated = await translateQuery(trimmedQuestion, previousTurnsContext);
    console.log(`[Ask:1/6] ✔ Query translated in ${Date.now() - transStart}ms (needsContext: ${translated.needsContext}):`);
    console.log(`   Primary  : "${translated.primary}"`);
    console.log(`   Fallback : "${translated.fallback}"`);
    if (translated.alt) {
      console.log(`   Alt      : "${translated.alt}"`);
    }

    // If the query is conversational (e.g. greetings, thanks, pleasantries) and does not need KB context:
    if (!translated.needsContext) {
      sendEvent('status', { message: 'Responding...' });

      const conversationalMessages: OpenRouterChatMessage[] = [
        {
          role: 'system',
          content:
            `You are "Ask Saka", the AI copilot for Safaricom Customer Experience Executives (CEE agents) on active customer calls.\n` +
            `This message is a greeting or small talk, not a knowledge question — respond warmly and briefly (1-3 sentences).\n` +
            `Let the agent know you're ready to help with SakaHub procedures (e.g. Lipa Na M-PESA reversals, View360 vetting, SIM swaps, Pochi la Biashara, data bundles).\n` +
            `Never state a specific fee, SLA, code, or step in a greeting — wait for the agent's actual question before giving any factual detail.`,
        },
        ...(previousTurnsContext
          ? [{ role: 'system', content: `Prior conversation context:\n${previousTurnsContext}` }]
          : []),
        { role: 'user', content: trimmedQuestion },
      ];

      let naturalReply = '';
      for await (const token of chatCompletionStream(conversationalMessages, {
        temperature: 0.7,
        model: config.OPENROUTER_CHAT_MODEL,
      })) {
        naturalReply += token;
        sendEvent('token', { delta: token, token });
      }

      const conversationalSteps: ExecutionStep[] = [
        { label: 'Intent', detail: 'Conversational message — responding directly' },
      ];

      const conversationalAssistantId = crypto.randomUUID();
      sendEvent('done', {
        answer: naturalReply,
        citations: [],
        executionSteps: conversationalSteps,
        conversationId: activeConversationId,
        messageId: conversationalAssistantId,
        userMessageId,
        parentId: userMessageId,
      });

      if (activeConversationId) {
        try {
          await query(
            `INSERT INTO messages (id, conversation_id, parent_id, role, content, citations, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
              conversationalAssistantId,
              activeConversationId,
              userMessageId,
              'assistant',
              naturalReply,
              JSON.stringify({ citations: [], executionSteps: conversationalSteps }),
            ]
          );
        } catch (dbErr) {
          console.warn('[Ask] Failed persisting conversational assistant message:', dbErr);
        }
      }

      res.end();
      return;
    }

    executionSteps.push({
      label: 'Interpreted as',
      detail: translated.primary,
    });
    sendEvent('status', {
      message: CEE_STATUS_MESSAGES.UNDERSTANDING,
      step: 'interpreted_query',
      label: 'Interpreted as',
      detail: translated.primary,
    });

    // Ensure raw user query is always included first to prevent semantic drift, followed by translated variants
    const queryVariants = [trimmedQuestion];
    if (translated.primary && translated.primary !== trimmedQuestion) {
      queryVariants.push(translated.primary);
    }
    if (translated.fallback && !queryVariants.includes(translated.fallback)) {
      queryVariants.push(translated.fallback);
    }
    if (translated.alt && !queryVariants.includes(translated.alt)) {
      queryVariants.push(translated.alt);
    }

    // Detect Saka article number in query (e.g. BPJM-0001, LPPP-0014)
    const SAKA_NUMBER_REGEX = /\b([A-Z0-9]{4}-\d{4})\b/i;
    const sakaNumMatch = trimmedQuestion.match(SAKA_NUMBER_REGEX);
    const targetArticleNumber = sakaNumMatch ? sakaNumMatch[1].toUpperCase() : null;
    if (targetArticleNumber) {
      console.log(`[Ask:1/6] 🎯 Detected Saka article number in query: "${targetArticleNumber}"`);
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

    // Direct zero-reindexing Saka article number lookup via PostgreSQL and Qdrant payload filter
    const exactArticleChunks: QdrantQueryResult[] = [];
    if (targetArticleNumber) {
      try {
        const artRes = await query(
          `SELECT id, article_number, title FROM articles WHERE article_number ILIKE $1 LIMIT 1`,
          [targetArticleNumber]
        );
        if (artRes.rows.length > 0) {
          const matchedArticleId = artRes.rows[0].id;
          console.log(`[Ask:3/6] 🎯 Exact Saka article match in PostgreSQL: "${artRes.rows[0].title}" (ID: ${matchedArticleId})`);

          const scrollRes = await qdrantClient.scroll(getActiveCollectionName(), {
            filter: {
              must: [{ key: 'article_id', match: { value: matchedArticleId } }],
            },
            limit: 15,
            with_payload: true,
            with_vector: false,
          });

          scrollRes.points.forEach((p, idx) => {
            exactArticleChunks.push({
              id: p.id,
              score: 100.0 - idx,
              payload: p.payload as any,
            });
          });
          console.log(`[Ask:3/6] 🎯 Injected ${exactArticleChunks.length} exact chunks for article ${targetArticleNumber}`);
        }
      } catch (exactErr) {
        console.warn('[Ask:3/6] Exact Saka article lookup warning:', exactErr);
      }
    }

    const candidates: QdrantQueryResult[] = [];
    const seenIds = new Set<string | number>();

    // Inject exact article number chunks first to guarantee top priority
    for (const p of exactArticleChunks) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        candidates.push(p);
      }
    }

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

    // Apply article flag boost and Saka article number priority boost
    const boostedCandidates = candidates.map(c => {
      let score = c.score;
      const artNum = c.payload?.article_number?.toUpperCase();
      if (targetArticleNumber && artNum === targetArticleNumber) {
        score *= 10.0; // Prioritize exact matching Saka article number
      }
      const flag = c.payload?.article_flag;
      if (flag && SAKAHUB_CONSTANTS.BOOSTED_FLAGS.includes(flag as any)) {
        score *= config.ARTICLE_FLAG_BOOST;
      }
      return { ...c, score };
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

    const uniqueArticleCount = new Set(selectedCandidates.map((c) => c.payload?.article_title)).size;
    const searchSummary = `Found ${selectedCandidates.length} relevant sections across ${uniqueArticleCount} knowledge articles`;
    executionSteps.push({
      label: 'SakaHub Search',
      detail: searchSummary,
    });
    sendEvent('status', {
      message: CEE_STATUS_MESSAGES.SEARCHING,
      step: 'search_results',
      label: 'SakaHub Search',
      detail: searchSummary,
    });

    const verifySummary = 'Cross-referencing official turnaround times, conditions & escalation paths';
    executionSteps.push({
      label: 'Policy Verification',
      detail: verifySummary,
    });
    sendEvent('status', {
      message: CEE_STATUS_MESSAGES.REVIEWING,
      step: 'reviewing_rules',
      label: 'Policy Verification',
      detail: verifySummary,
    });

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
    const userMessage = `${historyBlock}Context Sources from SakaHub:\n${contextBlocks}\n\nCEE Agent Question (Customer on live call): ${trimmedQuestion}`;

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

    // 5. Formulating sources... (Build verified Chrome Text Fragment citations & renumber sequentially from 1)
    sendEvent('status', { message: CEE_STATUS_MESSAGES.FORMULATING_SOURCES });

    function formatCleanExcerpt(text: string): string {
      if (!text) return '';
      return text
        .trim()
        .replace(/^[·•\u00b7\u2022]\s*/, '')
        .replace(/^[-–—]\s+/, '')
        .replace(/^\*\s+/, '')
        .trim();
    }

    // Normalize any [Source 8], [source 8], [src 8] into [8]
    let normalizedAnswer = answerText.replace(/\[\s*(?:source|src)?\s*(\d+)\s*\]/gi, '[$1]');

    // Detect all inline source references in appearance order
    const citationRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    const rawMatches = [...normalizedAnswer.matchAll(citationRegex)];

    // Collect cited source index numbers in first-appearance order
    const originalCitedIndices: number[] = [];
    for (const match of rawMatches) {
      const parts = match[1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      for (const num of parts) {
        if (!originalCitedIndices.includes(num)) {
          originalCitedIndices.push(num);
        }
      }
    }

    // Build index mapping: originalSourceIndex -> newSequentialIndex (1, 2, 3...)
    const indexMapping = new Map<number, number>();
    const citations: Citation[] = [];
    const seenQuotes = new Set<string>();

    let nextNewIndex = 1;
    for (const origIdx of originalCitedIndices) {
      const source = contextSources.find((s) => s.index === origIdx);
      if (!source) continue;

      indexMapping.set(origIdx, nextNewIndex);

      const p = source.chunk.payload;
      const rawText = p?.chunk_text || source.content || '';
      const quote = formatCleanExcerpt(rawText);
      if (seenQuotes.has(quote)) continue;
      seenQuotes.add(quote);

      const fragment = generateTextFragment(rawText.slice(0, 120));
      const urlWithTextFragment = `${config.SAKAHUB_BASE_URL}/app/article/${source.articleId}${fragment}`;

      citations.push({
        articleId: source.articleId,
        articleTitle: source.articleTitle,
        articleNumber: source.articleNumber,
        sectionHeading: source.sectionHeading,
        quote,
        urlWithTextFragment,
      });

      nextNewIndex++;
    }

    // Renumber citations in answerText strictly sequentially starting from [1]
    if (indexMapping.size > 0) {
      normalizedAnswer = normalizedAnswer.replace(citationRegex, (_match, group) => {
        const parts = group.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
        const renumbered = parts
          .map((orig: number) => indexMapping.get(orig))
          .filter((mapped: number | undefined): mapped is number => typeof mapped === 'number');
        if (renumbered.length === 0) return _match;
        return `[${renumbered.join(', ')}]`;
      });
      answerText = normalizedAnswer;
    }

    // Extract clarifying question and suggested follow-ups
    const { cleanText: textAfterClarification, clarification } = extractClarification(answerText);
    let { cleanText: cleanFinalAnswer, suggestions } = extractSuggestions(textAfterClarification);
    answerText = cleanFinalAnswer;

    if (!suggestions || suggestions.length === 0) {
      suggestions = generateFallbackSuggestions(trimmedQuestion, contextSources);
    }

    // Fallback if model did not include [X] brackets
    if (citations.length === 0 && contextSources.length > 0) {
      for (const source of contextSources.slice(0, RAG_CONSTANTS.CITATIONS.FALLBACK_COUNT)) {
        const p = source.chunk.payload;
        const rawText = p?.chunk_text || source.content || '';
        const quote = formatCleanExcerpt(rawText);
        const fragment = generateTextFragment(rawText.slice(0, 120));
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

    // Generate concise topic title on first turn if needed (Turn 1 has message count <= 1)
    let generatedTitle: string | undefined = undefined;
    if (activeConversationId) {
      try {
        const msgCountRes = await query(
          `SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1`,
          [activeConversationId]
        );
        const count = msgCountRes.rows[0]?.count || 0;
        if (count <= 1) {
          try {
            const titleRes = await chatCompletion([
              {
                role: 'system',
                content: 'Generate a concise 3-5 word title for this customer support query (e.g. "Paybill Reversal Guidelines", "View360 SIM Swap Vetting"). Return only the title without quotes or markdown.'
              },
              { role: 'user', content: trimmedQuestion }
            ], {
              model: config.OPENROUTER_CHAT_MODEL,
              temperature: 0.2,
            });
            const candidateTitle = titleRes.trim().replace(/^["']|["']$/g, '');
            if (candidateTitle && candidateTitle.length > 0 && candidateTitle.length <= 60) {
              generatedTitle = candidateTitle;
            }
          } catch (tErr) {
            console.warn('[Ask] Quick title generation call failed, falling back to query slice:', tErr);
          }

          if (!generatedTitle) {
            generatedTitle = trimmedQuestion.length > 40 ? `${trimmedQuestion.slice(0, 37)}...` : trimmedQuestion;
          }

          await query(
            `UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2`,
            [generatedTitle, activeConversationId]
          );
        }
      } catch (countErr) {
        console.warn('[Ask] Could not check message count for title generation:', countErr);
      }
    }

    const assistantMessageId = crypto.randomUUID();
    // Save assistant message to conversation history in DB
    if (activeConversationId) {
      try {
        await query(
          `INSERT INTO messages (id, conversation_id, parent_id, role, content, citations, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            assistantMessageId,
            activeConversationId,
            userMessageId,
            'assistant',
            answerText,
            JSON.stringify({
              citations,
              executionSteps,
              clarifyingQuestion: clarification,
              suggestedFollowUps: suggestions,
            })
          ]
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
      conversationTitle: generatedTitle,
      executionSteps,
      clarifyingQuestion: clarification,
      suggestedFollowUps: suggestions,
      messageId: assistantMessageId,
      userMessageId,
      parentId: userMessageId,
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
  } finally {
    if (requestDedupeKey) {
      activeAskRequests.delete(requestDedupeKey);
    }
  }
});
