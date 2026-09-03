import { Router, Request, Response } from 'express';
import { config } from '../config.js';
import { embedTexts, rerankChunks, chatCompletion } from '../services/openrouter.js';
import { queryPoints, QdrantQueryResult } from '../services/qdrant.js';
import { generateTextFragment } from '../services/chunker.js';

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
  cited_sources?: CitedSourceItem[];
}

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

    // 1. Generate query embedding
    const embedStart = Date.now();
    console.log(`[Ask:1/5] Generating query embedding via ${config.OPENROUTER_EMBED_MODEL}...`);
    const [queryVector] = await embedTexts([trimmedQuestion]);
    if (!queryVector) {
      console.error('[Ask:1/5] ❌ Failed to generate embedding for query.');
      res.status(500).json({ error: 'Failed to generate embedding for query' });
      return;
    }
    console.log(`[Ask:1/5] ✔ Embedding ready in ${Date.now() - embedStart}ms (dim: ${queryVector.length})`);

    // 2. Vector search in Qdrant for top candidates (e.g. 20)
    const searchStart = Date.now();
    console.log(`[Ask:2/5] Vector search in Qdrant (candidate limit: ${config.RETRIEVAL_CANDIDATES})...`);
    const candidates: QdrantQueryResult[] = await queryPoints(queryVector, config.RETRIEVAL_CANDIDATES);
    const searchMs = Date.now() - searchStart;

    if (candidates.length === 0) {
      console.warn(`[Ask:2/5] ⚠️ No matching vectors found in Qdrant (${searchMs}ms).`);
      res.json({
        answer: 'No relevant articles or information found in the SakaHub knowledge base for this query.',
        citations: [],
      });
      return;
    }

    const topScore = candidates[0]?.score ?? 0;
    const lowScore = candidates[candidates.length - 1]?.score ?? 0;
    console.log(`[Ask:2/5] ✔ Retrieved ${candidates.length} candidates in ${searchMs}ms (scores: ${topScore.toFixed(3)} down to ${lowScore.toFixed(3)})`);

    // 3. Rerank candidates using OpenRouter native /v1/rerank (with full contextual title & heading)
    const rerankStart = Date.now();
    const candidateTexts = candidates.map(c => {
      const p = c.payload;
      const numPrefix = p?.article_number ? `[${p.article_number}] ` : '';
      const heading = p?.section_heading ? ` > ${p.section_heading}` : '';
      return `${numPrefix}${p?.article_title || ''}${heading}\n${p?.chunk_text || ''}`;
    });
    console.log(`[Ask:3/5] Cross-encoder reranking top candidates via ${config.OPENROUTER_RERANK_MODEL || 'native score'} (top ${config.RERANK_TOP_K})...`);
    const rerankedResults = await rerankChunks(
      trimmedQuestion,
      candidateTexts,
      config.RERANK_TOP_K
    );

    // Pick top-ranked points
    const topChunks: QdrantQueryResult[] = rerankedResults
      .map(r => candidates[r.index])
      .filter((c): c is QdrantQueryResult => Boolean(c));

    const rerankMs = Date.now() - rerankStart;
    console.log(`[Ask:3/5] ✔ Pruned to ${topChunks.length} most relevant sources in ${rerankMs}ms:`);
    topChunks.forEach((c, idx) => {
      const p = c.payload;
      const score = rerankedResults[idx]?.relevanceScore ?? c.score ?? 0;
      console.log(`   #${idx + 1} [Rel: ${score.toFixed(3)}] [${p?.article_number || 'N/A'}] "${p?.article_title}" > "${p?.section_heading}"`);
    });

    // 4. Construct context for LLM synthesis
    const contextBlocks = topChunks.map((chunk, idx) => {
      const p = chunk.payload;
      const numPrefix = p?.article_number ? `[${p.article_number}] ` : '';
      return `[Source ${idx + 1}]
Article: ${numPrefix}${p?.article_title || 'Untitled'}
Article ID: ${p?.article_id || 'Unknown'}
Article Number: ${p?.article_number || 'N/A'}
Article Flag: ${p?.article_flag || 'Default'}
Section: ${p?.section_heading || 'General'}
Content:
${p?.chunk_text || ''}
`;
    }).join('\n---\n\n');

    const systemPrompt = `You are "Ask Saka", an expert AI assistant for Safaricom's SakaHub knowledge base.
Your job is to answer user queries accurately and professionally based strictly on the provided context sources.

Guidelines:
1. Ground your answer completely in the provided sources. Do not speculate or invent policies.
2. If the context does not contain sufficient details to answer, state clearly what is missing.
3. In your answer, reference sources using [1], [2], etc.
4. Output your response as valid JSON matching this exact schema:
{
  "answer": "Detailed answer in Markdown with inline [1], [2] citations...",
  "cited_sources": [
    {
      "source_index": 1,
      "exact_quote": "Exact sentence or clause from Source 1 supporting this point"
    }
  ]
}
Ensure the JSON is strictly valid and parseable without markdown backticks.`;

    const userMessage = `Context Sources:\n${contextBlocks}\n\nQuestion: ${trimmedQuestion}`;

    const llmStart = Date.now();
    console.log(`[Ask:4/5] Synthesizing answer via ${config.OPENROUTER_CHAT_MODEL}...`);
    const llmRawResponse = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ], {
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
    });
    const llmMs = Date.now() - llmStart;
    console.log(`[Ask:4/5] ✔ Answer generated in ${llmMs}ms (raw response: ${llmRawResponse.length} chars)`);

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

    // 5. Build structured citations with adaptive Chrome Text Fragments
    const citations: Citation[] = [];
    const seenQuotes = new Set<string>();

    for (const citationItem of citedList) {
      const sourceIndex = citationItem.source_index - 1;
      const chunk = topChunks[sourceIndex] || topChunks[0];
      if (!chunk || !chunk.payload) continue;

      const p = chunk.payload;
      const quote = citationItem.exact_quote || p.chunk_text.slice(0, 100);
      if (seenQuotes.has(quote)) continue;
      seenQuotes.add(quote);

      const fragment = generateTextFragment(quote);
      const urlWithTextFragment = `https://sakahub.safaricom.co.ke/app/article/${p.article_id}${fragment}`;

      citations.push({
        articleId: p.article_id,
        articleTitle: p.article_title,
        articleNumber: p.article_number || undefined,
        sectionHeading: p.section_heading,
        quote,
        urlWithTextFragment,
      });
    }

    // Fallback if model did not return structured cited_sources array
    if (citations.length === 0 && topChunks.length > 0) {
      for (const chunk of topChunks.slice(0, 3)) {
        if (!chunk.payload) continue;
        const p = chunk.payload;
        const quote = p.chunk_text.slice(0, 120);
        const fragment = generateTextFragment(quote);
        citations.push({
          articleId: p.article_id,
          articleTitle: p.article_title,
          articleNumber: p.article_number || undefined,
          sectionHeading: p.section_heading,
          quote,
          urlWithTextFragment: `https://sakahub.safaricom.co.ke/app/article/${p.article_id}${fragment}`,
        });
      }
    }

    const totalMs = Date.now() - requestStart;
    console.log(`[Ask:5/5] ✔ Prepared ${citations.length} verified citations. Total pipeline latency: ${totalMs}ms`);
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
