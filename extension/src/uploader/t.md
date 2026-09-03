
## Baseline gaps

| Layer | Current | Problem |
|---|---|---|
| Query | Raw `trimmedQuestion` embedded directly | Call center shorthand, brand nicknames, and typos never resolved |
| Retrieval | Dense-only (`text-embedding-3-small`) | Misses `LPPP-0014`, `*334#`, `Fuliza Biashara` exact terms |
| Contextual chunking | Isolated sub-chunks | Narrow context sent to LLM without parent section |
| Embedding model | `text-embedding-3-small` | `text-embedding-3-large` offers 3072 dimensions and higher semantic precision |
| Rerank top-K | 5 | Too aggressive — cuts good chunks before LLM sees them |
| Flag boost | None | KeyUpdates/Featured articles not prioritised |

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

const SYSTEM_PROMPT = `You are a query translation assistant for Saka Hub, Safaricom's internal knowledge base used by agents during live calls. Input is in English, typed quickly and informally: typos, call center abbreviations, product nicknames, and fragmented phrasing.

Task: Rewrite the raw English query into optimized retrieval input for a hybrid dense+sparse RAG pipeline. Never answer the question — only resolve terms, fix typos, and expand intent into official procedural terminology without inventing policies.

Method:
1. Normalize Brand Terms & Acronyms:
   - Resolve product nicknames to official services:
     fuliza → Fuliza M-PESA overdraft | okoa → Okoa Jahazi emergency airtime credit
     bonga → Bonga Points rewards | pochi → Pochi la Biashara merchant business wallet
     tunukiwa → Tunukiwa personalized offers | paybill → Lipa na M-PESA Paybill
     till → Lipa na M-PESA Buy Goods Till | fibre → Safaricom Home Fibre internet
   - Expand call center shorthand:
     rev → reversal | txn / trans → transaction | bal → balance | acc → account | sub → subscription | cust → customer
2. Expand Vague Verbs into Concrete Procedural Actions:
   - stuck / hang / pending → transaction pending, failed, or system timeout
   - block / locked / bar → line barred, SIM PIN/PUK locked, or account restricted
   - reverse / wrong number → transaction reversal request, incorrect recipient dispute
   - cancel / stop → unsubscribe, cancel service, or deactivate
3. Primary Query: Exactly one clear, semantically rich, grammatically complete English sentence. Not a keyword list.
4. Fallback: Primary query with the agent's original raw phrase appended verbatim.
5. Ambiguity: If two distinct support flows are plausible (e.g. SIM swap vs SIM line unbarring), output two full English queries. Otherwise "None".

Output format (strict — no extra text):
Primary query: <natural-language English rewrite>
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

### 1.3 · Increase RERANK_TOP_K + article_flag boost

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

### 1.4 · Swap embedding model → `openai/text-embedding-3-large`

Upgrades the dense representation to OpenAI's flagship 3072-dimension model for sharper semantic distinction across technical procedures. One env var change. Requires full reindex — the existing model-scoped collection name handles it automatically.

```ini
OPENROUTER_EMBED_MODEL=openai/text-embedding-3-large
```

---

## Tier 2 — Context & Chunking (do after Tier 1 is stable)

### 2.1 · Parent-document (small-to-big) retrieval

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
QDRANT_URL=https://xyz.qdrant.tech:6333
QDRANT_API_KEY=your-key
OPENROUTER_API_KEY=sk-or-v1-your-key

# Models
OPENROUTER_CHAT_MODEL=anthropic/claude-sonnet-4-5
OPENROUTER_EMBED_MODEL=openai/text-embedding-3-large       # upgraded (3072 dims)
OPENROUTER_CONTEXT_MODEL=google/gemini-2.5-flash
OPENROUTER_RERANK_MODEL=cohere/rerank-v3.5
QUERY_TRANSLATION_MODEL=google/gemini-2.5-flash     # fast + cheap, deterministic

# RAG hyperparameters
CHUNK_SIZE=128                  # child chunks for small-to-big
CHUNK_OVERLAP=20
RETRIEVAL_CANDIDATES=30         # up from 20
RERANK_TOP_K=15                 # up from 5
ARTICLE_FLAG_BOOST=1.15
```

---

## Implementation order

| # | Change | Files | Effort | Primary gain |
|---|---|---|---|---|
| 1 | Wire query translation | new `queryTranslator.ts`, `ask.ts`, `openrouter.ts` | 2h | slang/typo resolution |
| 2 | `RERANK_TOP_K=15` + flag boost | `ask.ts`, `.env` | 30min | fewer missed answers |
| 3 | Hybrid BM25 sparse + RRF | `qdrant.ts`, `reindex.ts`, `ask.ts` | 1 day | +26–31% exact-match recall |
| 4 | Swap to `text-embedding-3-large` + reindex | `.env` + reindex | 2h | higher dimensional accuracy |
| 5 | Small-to-big chunking | `chunker.ts`, `qdrant.ts`, `ask.ts` | 1 day | broader LLM context |

**Week 1:** Items 1–2 (no reindex needed, immediate wins)  
**Week 2:** Items 3–4 (both require reindex — batch them into one)  
**Week 3:** Item 5 (context refinement)