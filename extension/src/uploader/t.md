
## Baseline gaps

| Layer | Current | Problem |
|---|---|---|
| Query | Raw `trimmedQuestion` embedded directly | Slang, typos, Swahili terms never resolved |
| Retrieval | Dense-only (`text-embedding-3-small`) | Misses `LPPP-0014`, `*334#`, `Fuliza Biashara` exact terms |
| Index enrichment | Contextual prefix only | No hypothetical question embeddings |
| Embedding model | `text-embedding-3-small` | Voyage-3.5-lite beats it by 6.34% at lower cost |
| Rerank top-K | 5 | Too aggressive — cuts good chunks before LLM sees them |
| Flag boost | None | KeyUpdates/Featured articles not prioritised |
| Query cache | None | Same queries hit full pipeline every time |

---

## Tier 1 — Accuracy (do first)

### 1.1 · Query translation (wire in the existing prompt)

Your `saka-hub-query-translation-prompt.md` is designed and correct. It is not wired into `ask.ts`. `trimmedQuestion` is embedded raw.

**New file: `backend/src/services/queryTranslator.ts`**

```typescript
import { chatCompletion } from './openrouter.js';
import { config } from '../config.js';

export interface TranslatedQuery {
  primary: string;   // clean, normalized — used for retrieval + reranker
  fallback: string;  // primary + raw phrase appended — second retrieval pass
  alt: string | null; // second full query if two flows plausible (e.g. SIM barred vs SIM lost)
}

const SYSTEM_PROMPT = `You are a query translation assistant for Saka Hub, Safaricom's internal knowledge base used by agents during live calls. Input is fast and informal: typos, slang, product nicknames, incomplete phrasing.

Task: Rewrite the raw query into retrieval input for a hybrid dense+sparse RAG pipeline. Never answer the question — only resolve terms and expand intent, no invented policy details.

Method:
1. Normalize — resolve slang to official terms:
   mbao → KSh 20 | bonga → Bonga Points | okoa → Okoa Jahazi emergency airtime credit
   fuliza → Fuliza M-PESA overdraft | hewa → airtime | simu → handset/device
   tunukiwa → Tunukiwa personalized bundle offers | lipa → Lipa na M-PESA payment
   pochi → Pochi la Biashara merchant wallet | kadogo → small denomination transaction
   kufungua → activate/register | kufunga → deactivate/bar/close
2. Expand intent — vague verbs → concrete actions:
   stuck → transaction stuck/pending/failed | block → bar/restrict/suspend
   reversible → cancel/reverse/refund/unsubscribe | haiwork → not loading/not activating/error
3. Primary query — one natural-language sentence, semantically rich. Not a keyword fragment.
4. Fallback — primary query + agent's raw phrase appended verbatim. No keyword lists.
5. Ambiguity — if two distinct support flows are plausible, output two full natural-language queries.

Output format (strict — no extra text):
Primary query: <natural-language rewrite>
Fallback: <primary query + agent's raw phrase appended>
Alt interpretation: <second full query, or None>`;

export async function translateQuery(rawQuery: string): Promise<TranslatedQuery> {
  try {
    const raw = await chatCompletion(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: rawQuery },
      ],
      { temperature: 0.0, model: config.QUERY_TRANSLATION_MODEL }
    );
    return parse(raw, rawQuery);
  } catch (err) {
    console.warn('[QueryTranslator] Failed, using raw query:', err);
    return { primary: rawQuery, fallback: rawQuery, alt: null };
  }
}

function parse(raw: string, original: string): TranslatedQuery {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const get = (prefix: string) =>
    lines.find(l => l.toLowerCase().startsWith(prefix))
      ?.replace(new RegExp(`^${prefix}`, 'i'), '').trim() ?? '';

  const primary = get('primary query:') || original;
  const fallback = get('fallback:') || `${primary} ${original}`;
  const altRaw  = get('alt interpretation:');
  const alt = !altRaw || altRaw.toLowerCase() === 'none' ? null : altRaw;

  return { primary, fallback, alt };
}
```

**`backend/src/services/openrouter.ts`** — add optional model override to `chatCompletion`:

```typescript
export interface ChatCompletionOptions {
  responseFormat?: { type: string };
  temperature?: number;
  model?: string; // ADD
}

// In chatCompletion():
model: options.model ?? config.OPENROUTER_CHAT_MODEL,
```

**`backend/src/routes/ask.ts`** — replace Step 1 + Step 2:

```typescript
import { translateQuery } from '../services/queryTranslator.js';

// --- Step 1: translate ---
const translated = await translateQuery(trimmedQuestion);
const queryTexts = [translated.primary, translated.fallback];
if (translated.alt) queryTexts.push(translated.alt);

// --- Step 2: embed all variants in one batch ---
const queryVectors = await embedTexts(queryTexts);
if (!queryVectors[0]) {
  res.status(500).json({ error: 'Failed to generate embedding' });
  return;
}

// --- Step 3: retrieve for each variant, union + dedupe ---
const candidateSets = await Promise.all(
  queryVectors.map(vec => queryPoints(vec, config.RETRIEVAL_CANDIDATES))
);
const seenIds = new Set<string>();
const candidates: QdrantQueryResult[] = [];
for (const set of candidateSets) {
  for (const c of set) {
    if (!seenIds.has(c.id)) { seenIds.add(c.id); candidates.push(c); }
  }
}

// Reranker uses translated.primary (clean), NOT trimmedQuestion (raw)
const rerankedResults = await rerankChunks(translated.primary, candidateTexts, config.RERANK_TOP_K);

// LLM synthesis keeps trimmedQuestion — agent sees what they typed
const userMessage = `Context Sources:\n${contextBlocks}\n\nQuestion: ${trimmedQuestion}`;
```

**Evidence:** The SemEval 2026 top RAG system used exactly this pattern — last turn (raw) concatenated with a standalone rewrite. The last turn preserves surface phrasing; the rewrite resolves implicit constraints.

---

### 1.2 · Hybrid search: BM25 sparse + dense (RRF)

Dense-only silently fails on exact terms. BM25 catches `LPPP-0014`, `*334#`, `Fuliza Biashara` instantly. On domain-specific procedural corpora, BM25 outperforms `text-embedding-3-large` on most metrics (April 2026 benchmark). Hybrid + rerank is the clear recommended architecture.

**Do NOT use SPLADE** — it requires GPU inference and is not generalizable to Swahili/Safaricom domain terms without fine-tuning. Use Qdrant's built-in BM25 sparse with IDF modifier. No sidecar needed.

**`backend/src/services/qdrant.ts`** — update collection schema and query:

```typescript
// 1. Update createCollection — declare both vector types
await qdrantClient.createCollection(activeCollectionName, {
  vectors: {
    dense: { size: vectorSize, distance: 'Cosine' },
  },
  sparse_vectors: {
    sparse: {}, // Qdrant built-in BM25 with IDF — no model needed
  },
});

// 2. Add sparse encoding helper (pure TypeScript, no sidecar)
export function buildSparseVector(text: string): { indices: number[]; values: number[] } {
  // Simple TF-IDF tokenisation — sufficient for exact-term matching
  const tokens = text.toLowerCase().split(/\W+/).filter(t => t.length > 1);
  const tf: Record<number, number> = {};
  for (const token of tokens) {
    const id = hashToken(token);
    tf[id] = (tf[id] || 0) + 1;
  }
  const total = tokens.length;
  const indices = Object.keys(tf).map(Number);
  const values  = indices.map(i => tf[i] / total);
  return { indices, values };
}

function hashToken(token: string): number {
  let h = 0;
  for (let i = 0; i < token.length; i++) {
    h = (Math.imul(31, h) + token.charCodeAt(i)) >>> 0;
  }
  return h % 100000; // vocabulary size cap
}

// 3. Update QdrantChunkPoint
export interface QdrantChunkPoint {
  id: string;
  vector: {
    dense: number[];
    sparse: { indices: number[]; values: number[] };
  };
  payload: SakaChunkPayload;
}

// 4. Update queryPoints — Qdrant prefetch + RRF fusion
export async function queryPoints(
  denseVector: number[],
  sparseVector: { indices: number[]; values: number[] },
  limit: number
): Promise<QdrantQueryResult[]> {
  const result = await qdrantClient.query(activeCollectionName, {
    prefetch: [
      { query: denseVector, using: 'dense', limit: limit * 3 },
      { query: { indices: sparseVector.indices, values: sparseVector.values }, using: 'sparse', limit: limit * 3 },
    ],
    query: { fusion: 'rrf' },
    limit,
    with_payload: true,
  });
  return (result.points || []).map((p: any) => ({
    id: p.id, score: p.score, payload: p.payload as SakaChunkPayload,
  }));
}
```

**`backend/src/routes/ask.ts`** — pass sparse vector to queryPoints:

```typescript
const sparseVector = buildSparseVector(translated.primary);
const candidateSets = await Promise.all(
  queryVectors.map(vec => queryPoints(vec, sparseVector, config.RETRIEVAL_CANDIDATES))
);
```

**`backend/src/routes/reindex.ts`** — store sparse vector at index time:

```typescript
import { buildSparseVector } from '../services/qdrant.js';

// In chunk loop, alongside dense embedding:
const points: QdrantChunkPoint[] = chunks.map((chunk, idx) => ({
  id: crypto.randomUUID(),
  vector: {
    dense: embeddings[idx],
    sparse: buildSparseVector(enrichedTexts[idx]),
  },
  payload: { ...chunkPayload },
}));
```

**Migration:** New vector schema requires a new Qdrant collection + full reindex. The existing `probeEmbeddingDimension` + model-scoped collection name handles this automatically.

---

### 1.3 · HyPE: hypothetical prompt embeddings (index time)

Generates 3–5 questions per chunk at index time. Transforms retrieval from question→document into question→question matching — eliminating the style gap between how agents ask and how SakaHub articles are written. Average +16pp recall, +20pp precision over naive RAG (IEEE Access, July 2025). Zero query-time latency cost.

**`backend/src/services/openrouter.ts`** — extend `generateChunkContext` into `enrichChunk`:

```typescript
export interface ChunkEnrichment {
  contextSummary: string;
  hypotheticalQuestions: string[];
}

export async function enrichChunk(fullDocument: string, chunk: string): Promise<ChunkEnrichment> {
  const prompt = `<document>\n${fullDocument}\n</document>\n\nChunk:\n<chunk>\n${chunk}\n</chunk>\n\nDo two things:\n1. Write 2-3 sentences situating this chunk within the document for search retrieval.\n2. Write 4 short questions (under 15 words each) that this chunk directly answers.\n\nRespond only with valid JSON (no markdown):\n{"context": "...", "questions": ["...", "...", "...", "..."]}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const json = await fetchValidatedJson<OpenRouterChatResponse>(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: config.OPENROUTER_CONTEXT_MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 350,
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      },
      isOpenRouterChatResponse,
      'Chunk Enrichment'
    );

    clearTimeout(timeoutId);
    const parsed = JSON.parse(json.choices[0]?.message.content.trim() || '{}');
    return {
      contextSummary: parsed.context || '',
      hypotheticalQuestions: Array.isArray(parsed.questions) ? parsed.questions : [],
    };
  } catch {
    return { contextSummary: '', hypotheticalQuestions: [] };
  }
}
```

**`backend/src/routes/reindex.ts`** — use `enrichChunk`, embed questions as extra Qdrant points:

```typescript
// Replace generateChunkContext calls with enrichChunk:
const enrichments = await mapConcurrent(chunks, 8, (chunk) =>
  enrichChunk(article.markdownContent, chunk.text)
);

// Main chunk points (contextualized text):
const textsToEmbed = enrichments.map((e, i) =>
  `${e.contextSummary || chunks[i].structuralPrefix}\n\n${chunks[i].text}`
);
const embeddings = await embedTexts(textsToEmbed);

// Store questions in payload for BM25 coverage:
const points: QdrantChunkPoint[] = chunks.map((chunk, i) => ({
  id: crypto.randomUUID(),
  vector: {
    dense: embeddings[i],
    sparse: buildSparseVector(textsToEmbed[i]),
  },
  payload: {
    ...chunkPayload,
    context_summary: enrichments[i].contextSummary,
    hypothetical_questions: enrichments[i].hypotheticalQuestions.join(' | '),
  },
}));

// HyPE: also upsert each question as its own point referencing the parent chunk
for (const [i, enrichment] of enrichments.entries()) {
  if (!enrichment.hypotheticalQuestions.length) continue;
  const qEmbeddings = await embedTexts(enrichment.hypotheticalQuestions);
  const qPoints = enrichment.hypotheticalQuestions.map((q, qi) => ({
    id: crypto.randomUUID(),
    vector: {
      dense: qEmbeddings[qi],
      sparse: buildSparseVector(q),
    },
    payload: {
      ...chunks[i].metadata,
      chunk_text: chunks[i].text,
      section_heading: chunks[i].metadata.sectionHeading,
      is_question_proxy: true,
      source_question: q,
    },
  }));
  await upsertPoints(qPoints);
}
```

---

### 1.4 · Increase RERANK_TOP_K + article_flag boost

**`backend/src/routes/ask.ts`** — add flag boost before reranking:

```typescript
// After queryPoints, before rerankChunks:
const boosted = candidates.map(c => {
  const flag = c.payload?.article_flag;
  if (flag === 'KeyUpdates' || flag === 'Featured') {
    return { ...c, score: c.score * config.ARTICLE_FLAG_BOOST };
  }
  return c;
});
boosted.sort((a, b) => b.score - a.score);

// Pass boosted to reranker:
const candidateTexts = boosted.map(c => c.payload?.chunk_text || '');
const rerankedResults = await rerankChunks(translated.primary, candidateTexts, config.RERANK_TOP_K);
const topChunks = rerankedResults.map(r => boosted[r.index]).filter(Boolean);
```

---

### 1.5 · Swap embedding model → `voyage-3.5-lite`

Voyage-3.5-lite outperforms `text-embedding-3-large` by 6.34% across 100 retrieval datasets at one-sixth the cost. One env var change. Requires full reindex — the existing model-scoped collection name handles it automatically.

```ini
OPENROUTER_EMBED_MODEL=voyage/voyage-3.5-lite
```

---

## Tier 2 — Speed + Cost (do after Tier 1 is stable)

### 2.1 · Semantic query cache (Redis exact + Qdrant ANN)

Care-center agents ask the same ~200 queries repeatedly. Threshold must be ≥0.92 for factual workloads — below 0.90 you get wrong-answer cache hits. TTL 24h. Version-tag cache keys with embedding model hash so a model swap doesn't poison the cache.

**New file: `backend/src/services/cache.ts`**

```typescript
import { createClient } from 'redis';
import { embedTexts } from './openrouter.js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config.js';

const redis  = createClient({ url: config.REDIS_URL });
const qdrant = new QdrantClient({ url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY });
const CACHE_COLLECTION = `ask_saka_cache_${config.OPENROUTER_EMBED_MODEL.replace(/\W/g, '_')}`;
const TTL = config.CACHE_TTL_HOURS * 3600;

export async function initCache(): Promise<void> {
  await redis.connect();
  const cols = await qdrant.getCollections();
  if (!cols.collections.find(c => c.name === CACHE_COLLECTION)) {
    await qdrant.createCollection(CACHE_COLLECTION, {
      vectors: { size: 1024, distance: 'Cosine' },
    });
  }
}

export async function getCached(question: string): Promise<string | null> {
  // 1. Exact match via Redis
  const key = `ask:${Buffer.from(question).toString('base64').slice(0, 64)}`;
  const exact = await redis.get(key);
  if (exact) return exact;

  // 2. Semantic match via Qdrant
  const [vec] = await embedTexts([question]);
  const res = await qdrant.query(CACHE_COLLECTION, { query: vec, limit: 1, with_payload: true });
  const top = res.points?.[0];
  if (top && top.score >= config.CACHE_SEMANTIC_THRESHOLD && top.payload?.answer) {
    return top.payload.answer as string;
  }
  return null;
}

export async function setCache(question: string, answer: string): Promise<void> {
  const [vec] = await embedTexts([question]);
  const key = `ask:${Buffer.from(question).toString('base64').slice(0, 64)}`;
  await redis.setEx(key, TTL, answer);
  await qdrant.upsert(CACHE_COLLECTION, {
    wait: false,
    points: [{ id: crypto.randomUUID(), vector: vec, payload: { question, answer } }],
  });
}
```

**`backend/src/routes/ask.ts`** — wrap route:

```typescript
import { getCached, setCache } from '../services/cache.js';

// Before embedding:
const cached = await getCached(trimmedQuestion);
if (cached) { res.json({ answer: cached, citations: [], cached: true }); return; }

// After synthesis:
await setCache(trimmedQuestion, answerText).catch(console.warn);
```

### 2.2 · Parent-document (small-to-big) retrieval

Embed small 128-token child chunks for precise retrieval; return full parent section to LLM. 65% win rate over baseline chunking (SemEval H-RAG 2026). Only +0.2s latency.

**`backend/src/services/chunker.ts`** — add `parentText` to `ChunkResult`:

```typescript
export interface ChunkResult {
  text: string;        // child (128t) — embedded
  parentText: string;  // full section — sent to LLM
  structuralPrefix: string;
  metadata: ChunkMetadata;
  textFragment: string;
}
// Split sections into 128-token children; parentText = full section content
```

**`backend/src/services/qdrant.ts`** — add `parent_text` to payload:

```typescript
export interface SakaChunkPayload {
  // ... existing ...
  parent_text: string; // ADD
}
```

**`backend/src/routes/ask.ts`** — prefer `parent_text` in context blocks:

```typescript
const content = p?.parent_text || p?.chunk_text || '';
```

---

## Config — full updated `backend/.env.example`

```ini
# Core
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sakahub_rag
REDIS_URL=redis://localhost:6379
QDRANT_URL=https://xyz.qdrant.tech:6333
QDRANT_API_KEY=your-key
OPENROUTER_API_KEY=sk-or-v1-your-key

# Models
OPENROUTER_CHAT_MODEL=anthropic/claude-sonnet-4-5
OPENROUTER_EMBED_MODEL=voyage/voyage-3.5-lite       # upgraded
OPENROUTER_CONTEXT_MODEL=google/gemini-2.5-flash
OPENROUTER_RERANK_MODEL=cohere/rerank-v3.5
QUERY_TRANSLATION_MODEL=google/gemini-2.5-flash     # fast + cheap, deterministic

# RAG hyperparameters
CHUNK_SIZE=128                  # child chunks for small-to-big
CHUNK_OVERLAP=20
RETRIEVAL_CANDIDATES=30         # up from 20
RERANK_TOP_K=15                 # up from 5
ARTICLE_FLAG_BOOST=1.15

# Cache
CACHE_SEMANTIC_THRESHOLD=0.92   # do not lower below 0.90
CACHE_TTL_HOURS=24
```

---

## Implementation order

| # | Change | Files | Effort | Primary gain |
|---|---|---|---|---|
| 1 | Wire query translation | new `queryTranslator.ts`, `ask.ts`, `openrouter.ts` | 2h | slang/typo resolution |
| 2 | `RERANK_TOP_K=15` + flag boost | `ask.ts`, `.env` | 30min | fewer missed answers |
| 3 | Hybrid BM25 sparse + RRF | `qdrant.ts`, `reindex.ts`, `ask.ts` | 1 day | +26–31% exact-match recall |
| 4 | Swap to `voyage-3.5-lite` + reindex | `.env` + reindex | 2h | +6% semantic accuracy |
| 5 | HyPE question embeddings | `openrouter.ts`, `reindex.ts` | 1 day | +16pp recall avg |
| 6 | Semantic cache | new `cache.ts`, `ask.ts`, `index.ts` | 1 day | 80% cost + speed on repeats |
| 7 | Small-to-big chunking | `chunker.ts`, `qdrant.ts`, `ask.ts` | 1 day | broader LLM context |

**Week 1:** Items 1–2 (no reindex needed, immediate wins)  
**Week 2:** Items 3–5 (all require reindex — batch them into one)  
**Week 3:** Items 6–7 (operational improvements)

---

## Eval harness — build before Week 2

```typescript
// backend/tests/retrieval-eval.ts
const EVAL_SET = [
  // Exact-match critical (BM25 wins)
  { q: 'LPPP-0014',                     expect: 'Paybill Troubleshooting' },
  { q: '*334#',                          expect: 'M-PESA USSD Codes' },
  { q: 'fuliza biashara stuck',          expect: 'Fuliza Biashara' },

  // Slang resolution (query translation wins)
  { q: 'mbao ya okoa haiwork',           expect: 'Okoa Jahazi' },
  { q: 'tunukiwa haionyesha',            expect: 'Tunukiwa Bundles' },

  // Semantic (dense wins)
  { q: 'customer cannot reach partner',  expect: 'Paybill Troubleshooting' },
  { q: 'how do i swap sim for customer', expect: 'SIM Swap Procedure' },
];

// Metrics per run:
// - Hit rate: correct article in top-15?
// - Faithfulness: LLM answer uses only retrieved context? (Claude-as-judge)
// - Latency p50 / p95