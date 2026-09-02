# Ask Saka - Safaricom Knowledge Assistant (RAG & Real-Time Sync)

A production-grade, state-of-the-art Retrieval-Augmented Generation (RAG) assistant and Chrome Extension for Safaricom's internal SakaHub knowledge base (`https://sakahub.safaricom.co.ke`).

---

## Key Features

1. **Client-Side Markdown Conversion (`turndown` + GFM)**:
   - Official `turndown` and `turndown-plugin-gfm` with custom Word/MSO tag filters to eliminate ~96% of bloat before uploading.
   - Preserves headings, tables, bullet lists, and paragraphs.

2. **Full Strict TypeScript Architecture**:
   - Zero loose `.js` files in source directories.
   - Strictly typed interfaces for all OpenRouter APIs, Qdrant vectors and payloads, PostgreSQL queries, and Chrome extension messages.

3. **Production Extension Build Pipeline**:
   - Bundled with Vite and `@crxjs/vite-plugin` into `extension/dist/` with full Hot Module Replacement (HMR) during development and optimized production builds.

4. **Dynamic Size-Capped Batching**:
   - Buffers cleaned Markdown articles up to ~1MB of text or 20 articles max per batch to prevent HTTP timeouts.

5. **PostgreSQL Version Registry & Concurrency Lock**:
   - Distributed timestamp lock auto-refreshed (+3 minutes) on each incoming batch.
   - Exact set-diffing (`added`, `updated`, `deletedIds`).

6. **Hierarchical Splitting & Anthropic Contextual Retrieval**:
   - Markdown header splitting + recursive splitting (512 tokens, ~15% overlap).
   - Generates document-situated context with fast LLM (`google/gemini-2.0-flash-001`), with graceful fallback to structural prefixing.

7. **Qdrant Vector DB with Dynamic Auto-Dimension Probe & Payload Index**:
   - Probes embedding dimensions on startup and scopes collection names.
   - Creates a payload index on `article_id` for instant O(1) filtered deletions.

8. **Native OpenRouter Reranking (`/v1/rerank`)**:
   - Prunes top 20 Qdrant candidates down to the top 5 most relevant chunks using cross-encoders.

9. **W3C/Chrome Text Fragment Citations (`#:~:text=...`)**:
   - Generates adaptive Chrome Text Fragment URLs (`textStart,textEnd` range format for long quotes).
   - Clicking a citation opens SakaHub in a new tab, automatically scrolls to the exact section, and highlights the cited text in yellow.

---

## Project Structure

```
cee-tools/
├── .gitignore                     # Ignores node_modules, dist, .env, logs
├── backend/
│   ├── src/
│   │   ├── config.ts              # Zod-typed environment configuration
│   │   ├── db.ts                  # PostgreSQL pool and auto-migration
│   │   ├── index.ts               # Express application entrypoint
│   │   ├── routes/
│   │   │   ├── ask.ts             # POST /ask (RAG retrieval, reranking, synthesis)
│   │   │   ├── reindex.ts         # POST /reindex (Batch ingest, chunk, embed, upsert)
│   │   │   └── sync.ts            # GET /sync-status, GET /articles/versions, lock/unlock
│   │   └── services/
│   │       ├── chunker.ts         # Heading parser, recursive chunker, text fragment builder
│   │       ├── lock.ts            # Distributed timestamp sync lock manager
│   │       ├── openrouter.ts      # Strictly-typed OpenRouter API client
│   │       └── qdrant.ts          # Strictly-typed Qdrant client & payload indexer
│   ├── tests/
│   │   ├── chunker.test.ts        # Chunker unit tests
│   │   ├── diff.test.ts           # Set subtraction sync diff tests
│   │   └── text-fragment.test.ts  # W3C Chrome Text Fragment tests
│   ├── package.json
│   └── tsconfig.json
│
└── extension/
    ├── package.json               # Vite + @crxjs/vite-plugin + turndown dependencies
    ├── vite.config.ts             # CRXJS Vite build configuration
    ├── tsconfig.json              # Extension TypeScript configuration
    ├── public/
    │   └── icons/                 # Extension icons (16x16, 48x48, 128x128)
    ├── src/
    │   ├── manifest.json          # Chrome Manifest V3 declaration
    │   ├── types.ts               # Domain and Chrome messaging interfaces
    │   ├── background.ts          # Typed service worker & periodic sync alarms
    │   ├── popup/
    │   │   ├── popup.html         # Ask Saka UI
    │   │   ├── popup.css          # Sleek dark mode, glassmorphism, responsive layout
    │   │   └── popup.ts           # Strictly-typed interactive chat & citations UI
    │   └── scripts/
    │       ├── sakahub-api.ts     # SakaHub authenticated fetcher & probe
    │       ├── syncer.ts          # Staleness check, diffing, and dynamic batching
    │       └── turndown-cleaner.ts# Turndown + GFM Word HTML cleaner
    └── dist/                      # Production extension output loaded into Chrome
```

---

## Quickstart Guide

### 1. Backend Setup

```bash
cd backend
cp .env.example .env
```

Fill in your `.env` credentials:
```ini
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sakahub_rag

OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_CHAT_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_EMBED_MODEL=openai/text-embedding-3-small
OPENROUTER_CONTEXT_MODEL=google/gemini-2.0-flash-001
OPENROUTER_RERANK_MODEL=cohere/rerank-v3.5

QDRANT_URL=https://xyz.qdrant.tech:6333
QDRANT_API_KEY=your-qdrant-key
QDRANT_COLLECTION_BASE=saka_articles
```

Run tests and start dev server:
```bash
pnpm test     # Run all unit tests
pnpm dev      # Start dev server with tsx watch
```

Production build:
```bash
pnpm build
pnpm start
```

### 2. Chrome Extension Setup

```bash
cd extension
pnpm build    # Compiles TypeScript and bundles via Vite into extension/dist/
```

During development with Hot Module Replacement (HMR):
```bash
pnpm dev
```

### 3. Load Extension into Google Chrome

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the directory: `/home/gerison/coding/cee-tools/extension/dist`.
5. Pin **Ask Saka** to your Chrome toolbar.
6. Open Ask Saka from your toolbar to query knowledge base articles and jump to highlighted citations on SakaHub!
