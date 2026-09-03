import { config } from '../config.js';
import { buildContextualChunkPrompt } from '../prompts.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface RerankResult {
  index: number;
  relevanceScore: number;
}

export interface OpenRouterEmbeddingItem {
  embedding: number[];
  index: number;
  object?: string;
}

export interface OpenRouterEmbeddingResponse {
  data: OpenRouterEmbeddingItem[];
  model: string;
  object: string;
}

export interface OpenRouterChatMessage {
  role: string;
  content: string;
}

export interface OpenRouterChatChoice {
  message: OpenRouterChatMessage;
  finish_reason?: string;
  index: number;
}

export interface OpenRouterChatResponse {
  id: string;
  choices: OpenRouterChatChoice[];
  model: string;
}

export interface OpenRouterRerankResultItem {
  index: number;
  relevance_score?: number;
  score?: number;
}

export interface OpenRouterRerankResponse {
  results?: OpenRouterRerankResultItem[];
  data?: OpenRouterRerankResultItem[];
  model?: string;
}

function getAuthHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/sakahub-rag',
    'X-Title': 'Ask Saka RAG',
  };
}

// Type guards for safe runtime narrowing without 'as' casts
function isOpenRouterEmbeddingResponse(val: unknown): val is OpenRouterEmbeddingResponse {
  return (
    typeof val === 'object' &&
    val !== null &&
    'data' in val &&
    Array.isArray((val as Record<string, unknown>).data)
  );
}

function isOpenRouterChatResponse(val: unknown): val is OpenRouterChatResponse {
  return (
    typeof val === 'object' &&
    val !== null &&
    'choices' in val &&
    Array.isArray((val as Record<string, unknown>).choices)
  );
}

function isOpenRouterRerankResponse(val: unknown): val is OpenRouterRerankResponse {
  return (
    typeof val === 'object' &&
    val !== null &&
    ('results' in val || 'data' in val)
  );
}

async function fetchValidatedJson<T>(
  url: string,
  init: RequestInit,
  guard: (val: unknown) => val is T,
  errorContext: string
): Promise<T> {
  const start = Date.now();
  const endpoint = url.replace(OPENROUTER_BASE_URL, '');
  const response = await fetch(url, init);
  const latency = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[OpenRouter API] ❌ ${errorContext} ${endpoint} -> HTTP ${response.status} (${latency}ms): ${errorText}`);
    throw new Error(`[${errorContext}] HTTP ${response.status} ${response.statusText}: ${errorText}`);
  }

  const data: unknown = await response.json();
  if (!guard(data)) {
    console.error(`[OpenRouter API] ❌ ${errorContext} ${endpoint} -> Invalid response structure (${latency}ms)`);
    throw new Error(`[${errorContext}] Invalid response structure received`);
  }

  return data;
}

/**
 * Generates vector embeddings for a list of texts using OpenRouter embeddings API.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const json = await fetchValidatedJson<OpenRouterEmbeddingResponse>(
    `${OPENROUTER_BASE_URL}/embeddings`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        model: config.OPENROUTER_EMBED_MODEL,
        input: texts,
      }),
    },
    isOpenRouterEmbeddingResponse,
    'OpenRouter Embeddings'
  );

  return json.data.map(item => item.embedding);
}

/**
 * Probes the dimension of the configured embedding model by embedding a small token.
 */
export async function probeEmbeddingDimension(): Promise<number> {
  const embeddings = await embedTexts(['dimension_probe']);
  const firstVector = embeddings[0];
  if (!firstVector || firstVector.length === 0) {
    throw new Error('[OpenRouter] Failed to probe embedding dimension: empty response vector');
  }
  const dim = firstVector.length;
  console.log(`[OpenRouter] Probed embedding dimension for ${config.OPENROUTER_EMBED_MODEL}: ${dim}`);
  return dim;
}

/**
 * Generates Anthropic Contextual Retrieval context for a chunk.
 * If the call fails or times out, gracefully returns an empty string so fallback is used.
 */
export async function generateChunkContext(fullDocument: string, chunk: string): Promise<string> {
  const prompt = buildContextualChunkPrompt(fullDocument, chunk);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const json = await fetchValidatedJson<OpenRouterChatResponse>(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: config.OPENROUTER_CONTEXT_MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 150,
          temperature: 0.1,
        }),
        signal: controller.signal,
      },
      isOpenRouterChatResponse,
      'Contextual Retrieval'
    );

    clearTimeout(timeoutId);
    return json.choices[0]?.message.content.trim() || '';
  } catch (error) {
    console.warn(`[Contextual Retrieval Warning] Fallback to structural prefix:`, error);
    return '';
  }
}

/**
 * Reranks candidate document chunks using OpenRouter native /v1/rerank endpoint.
 * Gracefully falls back to the original vector ranking order if rerank is unavailable.
 */
export async function rerankChunks(
  query: string,
  documents: string[],
  topN: number
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];
  if (!config.OPENROUTER_RERANK_MODEL) {
    return documents.slice(0, topN).map((_, index) => ({
      index,
      relevanceScore: 1 - index * 0.05,
    }));
  }

  try {
    const json = await fetchValidatedJson<OpenRouterRerankResponse>(
      `${OPENROUTER_BASE_URL}/rerank`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: config.OPENROUTER_RERANK_MODEL,
          query,
          documents,
          top_n: topN,
        }),
      },
      isOpenRouterRerankResponse,
      'OpenRouter Rerank'
    );

    const items = json.results || json.data || [];
    return items.map(item => ({
      index: item.index,
      relevanceScore: item.relevance_score ?? item.score ?? 0,
    }));
  } catch (error) {
    console.warn(`[Rerank Warning] Error calling rerank API, falling back:`, error);
    return documents.slice(0, topN).map((_, index) => ({
      index,
      relevanceScore: 1 - index * 0.05,
    }));
  }
}

export interface ChatCompletionOptions {
  responseFormat?: { type: string };
  temperature?: number;
  model?: string;
}

/**
 * Sends a chat completion request to OpenRouter for final RAG answer synthesis.
 */
export async function chatCompletion(
  messages: OpenRouterChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<string> {
  const body: {
    model: string;
    messages: OpenRouterChatMessage[];
    temperature: number;
    response_format?: { type: string };
  } = {
    model: options.model ?? config.OPENROUTER_CHAT_MODEL,
    messages,
    temperature: options.temperature ?? 0.2,
  };

  if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  const json = await fetchValidatedJson<OpenRouterChatResponse>(
    `${OPENROUTER_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    },
    isOpenRouterChatResponse,
    'OpenRouter Chat'
  );

  return json.choices[0]?.message.content || '';
}
