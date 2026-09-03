import { extractArticlesFromResponse, normalizeSakaArticle } from '../scripts/sakahub-api.js';
import { cleanWordHtmlToMarkdown } from '../scripts/turndown-cleaner.js';
import { marked } from 'marked';
import {
  SakaNormalizedArticle,
  ChangedArticlePayload,
  ReindexBatchRequest,
  BackendSyncStatus,
} from '../types.js';

const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const MAX_BATCH_TEXT_CHARS = 1000000;
const MAX_BATCH_ARTICLES = 20;

let activeBackendUrl = DEFAULT_BACKEND_URL;
let clientId = `uploader_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
let allNormalizedArticles: SakaNormalizedArticle[] = [];
let convertedMarkdownCache: Map<string, string> = new Map();
let isIngestionRunning = false;

// DOM Element References
const backendStatusBadge = document.getElementById('backend-status-badge') as HTMLElement;
const backendStatusText = document.getElementById('backend-status-text') as HTMLElement;
const metricDbCount = document.getElementById('metric-db-count') as HTMLElement;
const metricQdrantName = document.getElementById('metric-qdrant-name') as HTMLElement;
const metricLastUpdated = document.getElementById('metric-last-updated') as HTMLElement;
const btnRefreshStats = document.getElementById('btn-refresh-stats') as HTMLButtonElement;
const btnOpenClearModal = document.getElementById('btn-open-clear-modal') as HTMLButtonElement;
const btnOpenPopup = document.getElementById('btn-open-popup') as HTMLButtonElement;

// Modal Elements
const clearDbModal = document.getElementById('clear-db-modal') as HTMLElement;
const btnCancelClearModal = document.getElementById('btn-cancel-clear-modal') as HTMLButtonElement;
const btnConfirmClearDb = document.getElementById('btn-confirm-clear-db') as HTMLButtonElement;

// Dropzone & File Elements
const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const btnBrowse = document.getElementById('btn-browse') as HTMLButtonElement;
const fileInfoBox = document.getElementById('file-info-box') as HTMLElement;
const fileInfoName = document.getElementById('file-info-name') as HTMLElement;
const fileInfoStats = document.getElementById('file-info-stats') as HTMLElement;
const btnRemoveFile = document.getElementById('btn-remove-file') as HTMLButtonElement;

// Scope Elements
const ingestionScopeCard = document.getElementById('ingestion-scope-card') as HTMLElement;
const labelScopeTest = document.getElementById('label-scope-test') as HTMLElement;
const labelScopeFull = document.getElementById('label-scope-full') as HTMLElement;
const fullScopeLabel = document.getElementById('full-scope-label') as HTMLElement;
const btnStartIngestion = document.getElementById('btn-start-ingestion') as HTMLButtonElement;
const btnStartText = document.getElementById('btn-start-text') as HTMLElement;

// Progress & Terminal Elements
const progressCard = document.getElementById('progress-card') as HTMLElement;
const progressStageTitle = document.getElementById('progress-stage-title') as HTMLElement;
const progressPctBadge = document.getElementById('progress-pct-badge') as HTMLElement;
const progressFillBar = document.getElementById('progress-fill-bar') as HTMLElement;
const statArticlesCount = document.getElementById('stat-articles-count') as HTMLElement;
const statBatchesCount = document.getElementById('stat-batches-count') as HTMLElement;
const statElapsedTime = document.getElementById('stat-elapsed-time') as HTMLElement;
const terminalLogBody = document.getElementById('terminal-log-body') as HTMLElement;
const btnClearLogs = document.getElementById('btn-clear-logs') as HTMLButtonElement;

// Preview Elements
const previewArticleSelect = document.getElementById('preview-article-select') as HTMLSelectElement;
const previewRenderedPane = document.getElementById('preview-rendered-pane') as HTMLElement;
const previewRawPane = document.getElementById('preview-raw-pane') as HTMLElement;
const previewRawCode = document.getElementById('preview-raw-code') as HTMLElement;
const previewTabBtns = document.querySelectorAll('.preview-tab-btn');

// --- Initialization ---
async function init(): Promise<void> {
  const result = await chrome.storage.local.get(['backendUrl']);
  if (typeof result.backendUrl === 'string' && result.backendUrl.trim()) {
    activeBackendUrl = result.backendUrl.trim();
  }

  logTerminal('info', `[Init] Ingestion Studio ready. Active backend: ${activeBackendUrl}`);
  await refreshDatabaseStats();
  setupEventListeners();
}

// --- Terminal Logger ---
function logTerminal(type: 'info' | 'success' | 'warn' | 'error', message: string): void {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${message}`;
  terminalLogBody.appendChild(line);
  terminalLogBody.scrollTop = terminalLogBody.scrollHeight;
}

// --- Database Status ---
async function refreshDatabaseStats(): Promise<void> {
  backendStatusBadge.className = 'status-pill status-checking';
  backendStatusText.textContent = 'Checking...';

  try {
    const res = await fetch(`${activeBackendUrl}/sync-status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as BackendSyncStatus & { activeCollection?: string };

    backendStatusBadge.className = 'status-pill status-connected';
    backendStatusText.textContent = 'Backend Connected';

    metricDbCount.textContent = (data.totalIndexed ?? 0).toLocaleString();
    metricQdrantName.textContent = data.activeCollection || 'saka_articles...';
    metricLastUpdated.textContent = data.maxLastUpdated
      ? new Date(data.maxLastUpdated).toLocaleString()
      : 'Never';

    logTerminal(
      'info',
      `[DB Stats] PostgreSQL: ${data.totalIndexed ?? 0} articles. Collection: ${data.activeCollection || 'N/A'}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    backendStatusBadge.className = 'status-pill status-error';
    backendStatusText.textContent = 'Disconnected';
    metricDbCount.textContent = 'Error';
    logTerminal('error', `[Backend Error] Could not connect to ${activeBackendUrl}: ${msg}`);
  }
}

// --- Clear Database ---
async function handleClearDatabase(): Promise<void> {
  clearDbModal.classList.add('hidden');
  btnConfirmClearDb.disabled = true;
  logTerminal('warn', '[ClearDB] Requesting complete database wipe from backend...');

  try {
    const res = await fetch(`${activeBackendUrl}/db/clear`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    logTerminal('success', `[ClearDB] Success: ${data.message || 'Database cleared.'}`);
    await refreshDatabaseStats();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logTerminal('error', `[ClearDB Failed] ${msg}`);
    alert(`Failed to clear database: ${msg}`);
  } finally {
    btnConfirmClearDb.disabled = false;
  }
}

// --- Event Listeners ---
function setupEventListeners(): void {
  btnRefreshStats.addEventListener('click', () => refreshDatabaseStats());

  btnOpenClearModal.addEventListener('click', () => {
    clearDbModal.classList.remove('hidden');
  });

  btnCancelClearModal.addEventListener('click', () => {
    clearDbModal.classList.add('hidden');
  });

  btnConfirmClearDb.addEventListener('click', () => handleClearDatabase());

  btnClearLogs.addEventListener('click', () => {
    terminalLogBody.innerHTML = '';
  });

  btnOpenPopup.addEventListener('click', () => {
    window.open(chrome.runtime.getURL('src/popup/popup.html'), '_blank');
  });

  // Dropzone drag & drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files?.[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  btnBrowse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  btnRemoveFile.addEventListener('click', () => resetFileState());

  // Scope Radio Switches
  labelScopeTest.addEventListener('click', () => {
    labelScopeTest.classList.add('active');
    labelScopeFull.classList.remove('active');
    labelScopeTest.querySelector('input')!.checked = true;
  });

  labelScopeFull.addEventListener('click', () => {
    labelScopeFull.classList.add('active');
    labelScopeTest.classList.remove('active');
    labelScopeFull.querySelector('input')!.checked = true;
  });

  // Preview Tabs
  previewTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      previewTabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      if (tab === 'rendered') {
        previewRenderedPane.classList.remove('hidden');
        previewRawPane.classList.add('hidden');
      } else {
        previewRenderedPane.classList.add('hidden');
        previewRawPane.classList.remove('hidden');
      }
    });
  });

  // Article Preview Select
  previewArticleSelect.addEventListener('change', () => {
    const selectedId = previewArticleSelect.value;
    updatePreview(selectedId);
  });

  // Ingestion Trigger
  btnStartIngestion.addEventListener('click', () => startIngestion());
}

// --- File Handling & Validation ---
async function handleFileSelected(file: File): Promise<void> {
  logTerminal('info', `[File] Reading ${file.name} (${formatBytes(file.size)})...`);
  resetFileState();

  try {
    const text = await file.text();
    const rawJson = JSON.parse(text);
    const { rawArticles } = extractArticlesFromResponse(rawJson);

    if (!rawArticles || rawArticles.length === 0) {
      throw new Error('No articles found in JSON export.');
    }

    const normalized: SakaNormalizedArticle[] = [];
    for (const raw of rawArticles) {
      const art = normalizeSakaArticle(raw);
      if (art) normalized.push(art);
    }

    if (normalized.length === 0) {
      throw new Error(`Parsed ${rawArticles.length} items, but none were active published articles.`);
    }

    allNormalizedArticles = normalized;
    convertedMarkdownCache.clear();

    fileInfoName.textContent = file.name;
    fileInfoStats.textContent = `${formatBytes(file.size)} • ${normalized.length} active articles (out of ${rawArticles.length} total)`;
    fullScopeLabel.textContent = `Full Knowledge Base (${normalized.length} Articles)`;

    fileInfoBox.classList.remove('hidden');
    dropzone.classList.add('hidden');
    ingestionScopeCard.classList.remove('hidden');
    btnStartIngestion.disabled = false;

    logTerminal(
      'success',
      `[File] Validated: ${normalized.length} active published articles ready for conversion.`
    );

    // Populate Preview Select
    populatePreviewSelect(normalized);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logTerminal('error', `[File Parse Error] ${msg}`);
    alert(`Could not process file: ${msg}`);
  }
}

function resetFileState(): void {
  allNormalizedArticles = [];
  convertedMarkdownCache.clear();
  fileInput.value = '';
  fileInfoBox.classList.add('hidden');
  dropzone.classList.remove('hidden');
  ingestionScopeCard.classList.add('hidden');
  btnStartIngestion.disabled = true;
  previewArticleSelect.innerHTML = '<option value="">Upload a .json file to inspect conversion</option>';
  previewArticleSelect.disabled = true;
  previewRenderedPane.innerHTML = `
    <div class="preview-empty-state">
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>
      <p>No article loaded yet.<br>Upload a file on the left to see live Markdown conversion.</p>
    </div>
  `;
  previewRawCode.textContent = 'No article loaded.';
}

// --- Preview Generation (Runs in Browser Tab with full DOMParser!) ---
function populatePreviewSelect(articles: SakaNormalizedArticle[]): void {
  previewArticleSelect.innerHTML = '';
  previewArticleSelect.disabled = false;

  articles.slice(0, 50).forEach((art, idx) => {
    const opt = document.createElement('option');
    opt.value = art.id;
    opt.textContent = `${idx + 1}. [${art.articleNumber || 'N/A'}] ${art.title}`;
    previewArticleSelect.appendChild(opt);
  });

  if (articles.length > 0 && articles[0]) {
    updatePreview(articles[0].id);
  }
}

function getOrConvertMarkdown(art: SakaNormalizedArticle): string {
  if (convertedMarkdownCache.has(art.id)) {
    return convertedMarkdownCache.get(art.id)!;
  }
  // Native DOM-enabled Turndown conversion!
  const md = cleanWordHtmlToMarkdown(art.contentHtml);
  convertedMarkdownCache.set(art.id, md);
  return md;
}

function updatePreview(articleId: string): void {
  const art = allNormalizedArticles.find((a) => a.id === articleId);
  if (!art) return;

  const markdown = getOrConvertMarkdown(art);

  // Render HTML preview
  previewRenderedPane.innerHTML = `
    <h1>${escapeHtml(art.title)}</h1>
    <div style="font-size: 12px; color: #9ca3af; margin-bottom: 14px;">
      Number: <strong>${escapeHtml(art.articleNumber || 'N/A')}</strong> • 
      Updated: <strong>${new Date(art.lastUpdated).toLocaleDateString()}</strong> • 
      Length: <strong>${markdown.length.toLocaleString()} chars</strong>
    </div>
    <div class="rendered-markdown-content">
      ${renderMarkdownToHtml(markdown)}
    </div>
  `;

  // Raw Markdown view
  previewRawCode.textContent = markdown;
}

// --- Ingestion Pipeline ---
async function startIngestion(): Promise<void> {
  if (isIngestionRunning || allNormalizedArticles.length === 0) return;

  const isTestScope = (document.querySelector('input[name="ingestion-scope"]:checked') as HTMLInputElement)?.value === 'test';
  const targetArticles = isTestScope ? allNormalizedArticles.slice(0, 5) : allNormalizedArticles;

  isIngestionRunning = true;
  btnStartIngestion.disabled = true;
  btnStartText.textContent = 'Ingesting...';
  progressCard.classList.remove('hidden');
  progressFillBar.style.width = '2%';
  progressPctBadge.textContent = '2%';
  progressStageTitle.textContent = 'Acquiring Backend Sync Lock...';

  const startTime = Date.now();
  const timerInterval = setInterval(() => {
    statElapsedTime.textContent = `Elapsed: ${Math.round((Date.now() - startTime) / 1000)}s`;
  }, 1000);

  logTerminal('info', `[Pipeline] Starting ingestion of ${targetArticles.length} articles (${isTestScope ? 'Test Mode: First 5' : 'Full Mode'}).`);

  try {
    // 1. Acquire Lock
    const lockRes = await fetch(`${activeBackendUrl}/sync/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });

    if (!lockRes.ok) {
      const err = await lockRes.json();
      throw new Error(err.message || 'Could not acquire sync lock.');
    }
    logTerminal('success', '[Lock] Sync lock acquired successfully.');

    // 2. Client-side Conversion and Batching
    progressStageTitle.textContent = 'Converting HTML to Markdown in DOM...';
    progressFillBar.style.width = '10%';
    progressPctBadge.textContent = '10%';

    const totalBatchesEst = Math.max(1, Math.ceil(targetArticles.length / MAX_BATCH_ARTICLES));
    let currentBatch: ChangedArticlePayload[] = [];
    let currentBatchChars = 0;
    let uploadedCount = 0;
    let batchIndex = 0;

    async function dispatchBatch(): Promise<void> {
      if (currentBatch.length === 0) return;
      batchIndex++;

      const batchPayload: ReindexBatchRequest = {
        changed: currentBatch,
        deletedIds: [],
        clientId,
      };

      logTerminal(
        'info',
        `[Batch ${batchIndex}/${totalBatchesEst}] Uploading ${currentBatch.length} articles (~${Math.round(currentBatchChars / 1024)} KB)...`
      );

      const res = await fetch(`${activeBackendUrl}/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchPayload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.message || `Reindex failed with HTTP ${res.status}`);
      }

      uploadedCount += currentBatch.length;
      currentBatch = [];
      currentBatchChars = 0;

      const pct = Math.min(99, Math.round(10 + (uploadedCount / targetArticles.length) * 88));
      progressFillBar.style.width = `${pct}%`;
      progressPctBadge.textContent = `${pct}%`;
      progressStageTitle.textContent = `Indexed ${uploadedCount} / ${targetArticles.length} articles...`;
      statArticlesCount.textContent = `Indexed: ${uploadedCount} / ${targetArticles.length}`;
      statBatchesCount.textContent = `Batch: ${batchIndex} / ${totalBatchesEst}`;

      logTerminal('success', `[Batch ${batchIndex}] Successfully indexed in Qdrant & PostgreSQL.`);
    }

    for (let i = 0; i < targetArticles.length; i++) {
      const art = targetArticles[i]!;
      const cleanMarkdown = getOrConvertMarkdown(art);

      currentBatch.push({
        id: art.id,
        title: art.title,
        articleNumber: art.articleNumber,
        markdownContent: cleanMarkdown,
        lastUpdated: art.lastUpdated,
        publishedAt: art.publishedAt,
        articleFlag: art.articleFlag,
      });
      currentBatchChars += cleanMarkdown.length;

      if (currentBatchChars >= MAX_BATCH_TEXT_CHARS || currentBatch.length >= MAX_BATCH_ARTICLES) {
        await dispatchBatch();
      }
    }

    await dispatchBatch();

    // 3. Release Lock
    await fetch(`${activeBackendUrl}/sync/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });

    progressFillBar.style.width = '100%';
    progressPctBadge.textContent = '100%';
    progressStageTitle.textContent = 'Ingestion Completed!';
    logTerminal(
      'success',
      `[Pipeline Completed] Successfully ingested ${uploadedCount} articles in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`
    );

    await refreshDatabaseStats();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logTerminal('error', `[Pipeline Failed] ${msg}`);
    progressStageTitle.textContent = 'Ingestion Failed';
    alert(`Ingestion error: ${msg}`);

    try {
      await fetch(`${activeBackendUrl}/sync/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
    } catch {}
  } finally {
    clearInterval(timerInterval);
    isIngestionRunning = false;
    btnStartIngestion.disabled = false;
    btnStartText.textContent = 'Start Ingestion Pipeline';
  }
}

// --- Helpers ---
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdownToHtml(md: string): string {
  if (!md) return '';
  return marked.parse(md, { gfm: true, breaks: true }) as string;
}

// Start
init();
