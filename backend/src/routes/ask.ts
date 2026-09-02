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
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    const trimmedQuestion = question.trim();

    // 1. Generate query embedding
    const [queryVector] = await embedTexts([trimmedQuestion]);
    if (!queryVector) {
      res.status(500).json({ error: 'Failed to generate embedding for query' });
      return;
    }

    // 2. Vector search in Qdrant for top candidates (e.g. 20)
    const candidates: QdrantQueryResult[] = await queryPoints(queryVector, config.RETRIEVAL_CANDIDATES);
    if (candidates.length === 0) {
      res.json({
        answer: 'No relevant articles or information found in the SakaHub knowledge base for this query.',
        citations: [],
      });
      return;
    }

    // 3. Rerank candidates using OpenRouter native /v1/rerank
    const candidateTexts = candidates.map(c => c.payload?.chunk_text || '');
    const rerankedResults = await rerankChunks(
      trimmedQuestion,
      candidateTexts,
      config.RERANK_TOP_K
    );

    // Pick top-ranked points
    const topChunks: QdrantQueryResult[] = rerankedResults
      .map(r => candidates[r.index])
      .filter((c): c is QdrantQueryResult => Boolean(c));

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

    const llmRawResponse = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ], {
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
    });

    function parseAskOutput(raw: string): AskLlmStructuredOutput {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          return { answer: raw, cited_sources: [] };
        }
      }

      if (typeof parsed === 'object' && parsed !== null && 'answer' in parsed) {
        const record = parsed as { answer?: unknown; cited_sources?: unknown };
        const answer = typeof record.answer === 'string' ? record.answer : raw;
        const cited_sources = Array.isArray(record.cited_sources) ? record.cited_sources : [];
        return { answer, cited_sources };
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
