import {
  AskResponse,
  Citation,
  ExtensionMessage,
  SakaNormalizedArticle,
  StalenessCheckResult,
  SyncProgressUpdate,
  UploadProgressUpdate,
} from '../types.js';
import { extractArticlesFromResponse, normalizeSakaArticle } from '../scripts/sakahub-api.js';
import { marked } from 'marked';

/**
 * Type-safe element retriever using runtime instanceof narrowing (zero 'as' casts).
 */
function requireElement<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (el instanceof ctor) {
    return el;
  }
  throw new Error(`Element #${id} not found or not of type ${ctor.name}`);
}

// DOM Elements
const syncBadge = requireElement('sync-status-badge', HTMLDivElement);
const syncText = requireElement('sync-status-text', HTMLSpanElement);
const syncBanner = requireElement('sync-banner', HTMLDivElement);
const syncBannerTitle = requireElement('sync-banner-title', HTMLElement);
const syncBannerDesc = requireElement('sync-banner-desc', HTMLSpanElement);
const btnSyncNow = requireElement('btn-sync-now', HTMLButtonElement);
const progressBarContainer = requireElement('sync-progress-bar-container', HTMLDivElement);
const progressBar = requireElement('sync-progress-bar', HTMLDivElement);

const askForm = requireElement('ask-form', HTMLFormElement);
const queryInput = requireElement('query-input', HTMLTextAreaElement);
const suggestionsContainer = requireElement('suggestions-container', HTMLDivElement);
const resultsArea = requireElement('results-area', HTMLDivElement);
const answerBody = requireElement('answer-body', HTMLDivElement);
const citationsSection = requireElement('citations-section', HTMLDivElement);
const citationsList = requireElement('citations-list', HTMLDivElement);
const citationsCount = requireElement('citations-count', HTMLSpanElement);
const loadingState = requireElement('loading-state', HTMLDivElement);
const loadingText = requireElement('loading-text', HTMLParagraphElement);
const btnCopy = requireElement('btn-copy-answer', HTMLButtonElement);

// Settings Elements
const btnSettingsToggle = requireElement('btn-settings-toggle', HTMLButtonElement);
const settingsModal = requireElement('settings-modal', HTMLDivElement);
const btnCloseSettings = requireElement('btn-close-settings', HTMLButtonElement);
const inputBackendUrl = requireElement('input-backend-url', HTMLInputElement);
const btnTestConnection = requireElement('btn-test-connection', HTMLButtonElement);
const btnSaveSettings = requireElement('btn-save-settings', HTMLButtonElement);
const connectionTestResult = requireElement('connection-test-result', HTMLDivElement);

// Upload Elements
const btnUploadToggle = requireElement('btn-upload-toggle', HTMLButtonElement);
const uploadModal = requireElement('upload-modal', HTMLDivElement);
const btnCloseUpload = requireElement('btn-close-upload', HTMLButtonElement);
const btnCancelUpload = requireElement('btn-cancel-upload', HTMLButtonElement);
const uploadDropzone = requireElement('upload-dropzone', HTMLDivElement);
const uploadFileInput = requireElement('upload-file-input', HTMLInputElement);
const btnBrowseFile = requireElement('btn-browse-file', HTMLButtonElement);
const uploadFileCard = requireElement('upload-file-card', HTMLDivElement);
const uploadFileName = requireElement('upload-file-name', HTMLSpanElement);
const uploadFileMeta = requireElement('upload-file-meta', HTMLSpanElement);
const btnRemoveFile = requireElement('btn-remove-file', HTMLButtonElement);
const uploadParseStatus = requireElement('upload-parse-status', HTMLDivElement);
const uploadProgressSection = requireElement('upload-progress-section', HTMLDivElement);
const uploadProgressStatus = requireElement('upload-progress-status', HTMLSpanElement);
const uploadProgressPct = requireElement('upload-progress-pct', HTMLSpanElement);
const uploadProgressBar = requireElement('upload-progress-bar', HTMLDivElement);
const uploadStatCount = requireElement('upload-stat-count', HTMLSpanElement);
const uploadStatBatches = requireElement('upload-stat-batches', HTMLSpanElement);
const btnStartUpload = requireElement('btn-start-upload', HTMLButtonElement);

let parsedArticles: SakaNormalizedArticle[] = [];
let activeBackendUrl = 'http://localhost:3000';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['backendUrl', 'uploadProgress']);
  if (typeof stored.backendUrl === 'string') {
    activeBackendUrl = stored.backendUrl;
  }
  inputBackendUrl.value = activeBackendUrl;

  refreshSyncStatus();

  // If opened with #upload hash or in tab view, activate in-tab mode and show upload modal
  if (window.location.hash.includes('upload') || window.innerWidth > 500) {
    document.body.classList.add('in-tab');
    uploadModal.classList.remove('hidden');
  }

  // Restore upload progress if one is active
  if (stored.uploadProgress && typeof stored.uploadProgress === 'object') {
    const up = stored.uploadProgress as UploadProgressUpdate;
    if (up.stage === 'uploading' || up.stage === 'cleaning' || up.stage === 'diffing') {
      uploadModal.classList.remove('hidden');
      handleUploadProgress(up);
    }
  }
});

// Listen for background worker messages
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'SYNC_PROGRESS') {
    handleProgressUpdate(message.progress);
  } else if (message.type === 'SYNC_COMPLETED') {
    setSyncState('synced', 'Up to date');
    syncBanner.classList.add('hidden');
    progressBarContainer.classList.add('hidden');
  } else if (message.type === 'SYNC_ERROR') {
    setSyncState('behind', 'Sync error');
    syncBannerTitle.textContent = 'Sync Failed';
    syncBannerDesc.textContent = message.error;
    progressBarContainer.classList.add('hidden');
    btnSyncNow.disabled = false;
  } else if (message.type === 'UPLOAD_PROGRESS') {
    handleUploadProgress(message.progress);
  } else if (message.type === 'UPLOAD_COMPLETED') {
    handleUploadCompleted(message.result);
  } else if (message.type === 'UPLOAD_ERROR') {
    handleUploadError(message.error);
  }
});

function handleProgressUpdate(progress: SyncProgressUpdate): void {
  setSyncState('syncing', `Syncing (${progress.progressPercent || 0}%)`);
  syncBanner.classList.remove('hidden');
  progressBarContainer.classList.remove('hidden');
  progressBar.style.width = `${progress.progressPercent || 0}%`;
  syncBannerTitle.textContent = 'Syncing Knowledge Base';
  syncBannerDesc.textContent = progress.message;
  btnSyncNow.disabled = true;
}

function setSyncState(state: 'synced' | 'behind' | 'syncing' | 'checking', text: string): void {
  syncBadge.className = `status-pill status-${state}`;
  syncText.textContent = text;
}

async function refreshSyncStatus(): Promise<void> {
  setSyncState('checking', 'Checking...');

  chrome.runtime.sendMessage<ExtensionMessage, { success: boolean; data?: StalenessCheckResult; error?: string }>(
    { type: 'CHECK_STALENESS' },
    (response) => {
      if (!response || !response.success || !response.data) {
        setSyncState('behind', 'Offline / Disconnected');
        return;
      }

      const data = response.data;
      if (data.isSyncing) {
        setSyncState('syncing', 'Sync in progress');
        syncBanner.classList.remove('hidden');
        syncBannerTitle.textContent = 'Syncing in Progress';
        syncBannerDesc.textContent = 'Another client or background worker is currently indexing articles.';
        btnSyncNow.disabled = true;
      } else if (data.isBehind) {
        setSyncState('behind', 'Sync required');
        syncBanner.classList.remove('hidden');
        syncBannerTitle.textContent = 'Updates Available';
        syncBannerDesc.textContent = data.reason || 'SakaHub articles have changed since last sync.';
        btnSyncNow.disabled = false;
      } else {
        setSyncState('synced', `Up to date (${data.backendCount})`);
        syncBanner.classList.add('hidden');
      }
    }
  );
}

// 2. Manual Sync Button
btnSyncNow.addEventListener('click', () => {
  btnSyncNow.disabled = true;
  setSyncState('syncing', 'Starting sync...');
  progressBarContainer.classList.remove('hidden');
  progressBar.style.width = '5%';

  chrome.runtime.sendMessage<ExtensionMessage, { success: boolean; error?: string }>(
    { type: 'START_SYNC' },
    (response) => {
      if (!response || !response.success) {
        alert(response?.error || 'Failed to trigger background sync.');
        btnSyncNow.disabled = false;
        refreshSyncStatus();
      }
    }
  );
});

// 3. Question Form Submission
askForm.addEventListener('submit', (e: SubmitEvent) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;
  submitQuestion(query);
});

queryInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    askForm.dispatchEvent(new Event('submit'));
  }
});

// Suggestion chips
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const q = chip.getAttribute('data-query');
    if (q) {
      queryInput.value = q;
      submitQuestion(q);
    }
  });
});

async function submitQuestion(question: string): Promise<void> {
  suggestionsContainer.classList.add('hidden');
  resultsArea.classList.add('hidden');
  loadingState.classList.remove('hidden');
  loadingText.textContent = 'Understanding request...';
  answerBody.innerHTML = '';
  citationsSection.classList.add('hidden');

  try {
    const response = await fetch(`${activeBackendUrl}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ question, stream: true }),
    });

    if (!response.ok) {
      const errJson: unknown = await response.json().catch(() => ({}));
      const message =
        typeof errJson === 'object' && errJson !== null && 'message' in errJson
          ? String((errJson as Record<string, unknown>).message)
          : `Server returned ${response.status}`;
      throw new Error(message);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedAnswer = '';
      let citationsRendered = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = 'message';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7).trim();
            continue;
          }
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(dataStr);
              if (currentEvent === 'status' && parsed.message) {
                loadingText.textContent = parsed.message;
              } else if (currentEvent === 'token' && parsed.delta) {
                accumulatedAnswer += parsed.delta;
                loadingState.classList.add('hidden');
                resultsArea.classList.remove('hidden');
                answerBody.innerHTML = renderSimpleMarkdown(accumulatedAnswer);
              } else if (currentEvent === 'citations' && Array.isArray(parsed.citations)) {
                renderCitationsList(parsed.citations);
                citationsRendered = true;
              } else if (currentEvent === 'done') {
                if (parsed.answer) {
                  accumulatedAnswer = parsed.answer;
                  answerBody.innerHTML = renderSimpleMarkdown(accumulatedAnswer);
                }
                if (parsed.citations && !citationsRendered) {
                  renderCitationsList(parsed.citations);
                }
              } else if (currentEvent === 'error') {
                throw new Error(parsed.message || 'Stream error occurred');
              }
            } catch (err) {
              if (currentEvent === 'error') throw err;
            }
          }
        }
      }
    } else {
      const data: unknown = await response.json();
      if (typeof data === 'object' && data !== null && 'answer' in data) {
        displayAnswer(data as AskResponse);
      } else {
        throw new Error('Malformed answer format received from backend');
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Ask error:', error);
    loadingState.classList.add('hidden');
    resultsArea.classList.remove('hidden');
    answerBody.innerHTML = `<p style="color: #ef4444;"><strong>Error:</strong> ${escapeHtml(msg)}</p>
      <p style="color: #9ca3af; font-size: 11.5px; margin-top: 6px;">Ensure the Ask Saka backend server is running and reachable at <code>${escapeHtml(activeBackendUrl)}</code>.</p>`;
    citationsSection.classList.add('hidden');
  }
}

function displayAnswer(data: AskResponse): void {
  loadingState.classList.add('hidden');
  resultsArea.classList.remove('hidden');
  answerBody.innerHTML = renderSimpleMarkdown(data.answer);
  renderCitationsList(data.citations || []);
}

function renderCitationsList(citations: Citation[]): void {
  if (citations.length > 0) {
    citationsSection.classList.remove('hidden');
    citationsCount.textContent = citations.length.toString();
    citationsList.innerHTML = '';

    citations.forEach((c: Citation) => {
      const card = document.createElement('div');
      card.className = 'citation-card';

      const meta = document.createElement('div');
      meta.className = 'citation-meta';

      const titleGroup = document.createElement('div');
      titleGroup.className = 'citation-title-group';

      const title = document.createElement('span');
      title.className = 'citation-title';
      title.textContent = c.articleTitle;
      titleGroup.appendChild(title);

      if (c.articleNumber) {
        const badge = document.createElement('span');
        badge.className = 'citation-badge';
        badge.textContent = c.articleNumber;
        titleGroup.appendChild(badge);
      }
      meta.appendChild(titleGroup);

      if (c.sectionHeading) {
        const section = document.createElement('span');
        section.className = 'citation-section-path';
        section.textContent = c.sectionHeading;
        meta.appendChild(section);
      }
      card.appendChild(meta);

      if (c.quote) {
        const quoteBox = document.createElement('blockquote');
        quoteBox.className = 'citation-quote';
        quoteBox.textContent = `"${c.quote}"`;
        card.appendChild(quoteBox);
      }

      const linkBtn = document.createElement('a');
      linkBtn.className = 'btn-jump-highlight';
      linkBtn.href = c.urlWithTextFragment;
      linkBtn.target = '_blank';
      linkBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
        Jump to highlight on SakaHub
      `;

      linkBtn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        chrome.tabs.create({ url: c.urlWithTextFragment });
      });

      card.appendChild(linkBtn);
      citationsList.appendChild(card);
    });
  } else {
    citationsSection.classList.add('hidden');
  }
}

// Copy answer text
btnCopy.addEventListener('click', () => {
  const text = answerBody.innerText;
  navigator.clipboard.writeText(text).then(() => {
    btnCopy.textContent = 'Copied!';
    setTimeout(() => {
      btnCopy.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy
      `;
    }, 2000);
  });
});

// 4. Settings Modal
btnSettingsToggle.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
  connectionTestResult.classList.add('hidden');
});

btnCloseSettings.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

btnTestConnection.addEventListener('click', async () => {
  const url = inputBackendUrl.value.trim().replace(/\/$/, '');
  connectionTestResult.className = 'test-result-box';
  connectionTestResult.textContent = 'Connecting to backend...';
  connectionTestResult.classList.remove('hidden');

  try {
    const res = await fetch(`${url}/health`);
    if (res.ok) {
      const json: unknown = await res.json();
      const serviceName =
        typeof json === 'object' && json !== null && 'service' in json
          ? String((json as Record<string, unknown>).service)
          : 'Ask Saka';
      connectionTestResult.className = 'test-result-box success';
      connectionTestResult.textContent = `Connected successfully! (${serviceName})`;
    } else {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    connectionTestResult.className = 'test-result-box error';
    connectionTestResult.textContent = `Connection failed: ${msg}`;
  }
});

btnSaveSettings.addEventListener('click', async () => {
  const url = inputBackendUrl.value.trim().replace(/\/$/, '');
  if (!url) return;

  await chrome.storage.local.set({ backendUrl: url });
  activeBackendUrl = url;
  settingsModal.classList.add('hidden');
  refreshSyncStatus();
});

// 5. Upload Knowledge Base Studio
btnUploadToggle.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/uploader/uploader.html') });
});

btnCloseUpload.addEventListener('click', () => {
  uploadModal.classList.add('hidden');
});

btnCancelUpload.addEventListener('click', () => {
  uploadModal.classList.add('hidden');
});

uploadDropzone.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/uploader/uploader.html') });
});

btnBrowseFile.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation();
  chrome.tabs.create({ url: chrome.runtime.getURL('src/uploader/uploader.html') });
});

uploadDropzone.addEventListener('dragover', (e: DragEvent) => {
  e.preventDefault();
  uploadDropzone.classList.add('dragover');
});

uploadDropzone.addEventListener('dragleave', () => {
  uploadDropzone.classList.remove('dragover');
});

uploadDropzone.addEventListener('drop', (e: DragEvent) => {
  e.preventDefault();
  uploadDropzone.classList.remove('dragover');
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    if (file) handleFile(file);
  }
});

uploadFileInput.addEventListener('change', () => {
  const file = uploadFileInput.files?.[0];
  if (file) handleFile(file);
});

btnRemoveFile.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation();
  parsedArticles = [];
  uploadFileInput.value = '';
  uploadFileCard.classList.add('hidden');
  uploadDropzone.classList.remove('hidden');
  uploadParseStatus.classList.add('hidden');
  uploadProgressSection.classList.add('hidden');
  btnStartUpload.disabled = true;
});

async function handleFile(file: File): Promise<void> {
  uploadParseStatus.className = 'test-result-box';
  uploadParseStatus.textContent = `Reading & validating ${file.name} (${formatFileSize(file.size)})...`;
  uploadParseStatus.classList.remove('hidden');
  btnStartUpload.disabled = true;

  try {
    const text = await file.text();
    const rawJson: unknown = JSON.parse(text);
    const { rawArticles } = extractArticlesFromResponse(rawJson);

    if (!rawArticles || rawArticles.length === 0) {
      throw new Error('No articles found in this JSON. Expected an array of SakaHub articles.');
    }

    const normalized: SakaNormalizedArticle[] = [];
    for (const raw of rawArticles) {
      const art = normalizeSakaArticle(raw);
      if (art) normalized.push(art);
    }

    if (normalized.length === 0) {
      throw new Error(`Parsed ${rawArticles.length} items, but none were active published articles.`);
    }

    // Limit to first 5 articles for testing as requested
    const limitedArticles = normalized.slice(0, 5);
    parsedArticles = limitedArticles;

    uploadFileName.textContent = file.name;
    uploadFileMeta.textContent = `${formatFileSize(file.size)} • First ${limitedArticles.length} articles selected (Testing limit: 5 of ${normalized.length})`;

    uploadFileCard.classList.remove('hidden');
    uploadDropzone.classList.add('hidden');
    uploadParseStatus.className = 'test-result-box success';
    uploadParseStatus.textContent = `✔ Loaded first ${limitedArticles.length} articles (of ${normalized.length} total) for testing. Ready for ingestion.`;

    btnStartUpload.disabled = false;
  } catch (err: unknown) {
    parsedArticles = [];
    btnStartUpload.disabled = true;
    const msg = err instanceof Error ? err.message : String(err);
    uploadParseStatus.className = 'test-result-box error';
    uploadParseStatus.textContent = `File error: ${msg}`;
    uploadFileCard.classList.add('hidden');
    uploadDropzone.classList.remove('hidden');
  }
}

btnStartUpload.addEventListener('click', () => {
  if (parsedArticles.length === 0) return;

  btnStartUpload.disabled = true;
  uploadParseStatus.classList.add('hidden');
  uploadProgressSection.classList.remove('hidden');
  uploadProgressBar.style.width = '2%';
  uploadProgressStatus.textContent = 'Starting background ingestion...';
  uploadProgressPct.textContent = '2%';
  uploadStatCount.textContent = `Indexed: 0 / ${parsedArticles.length}`;
  uploadStatBatches.textContent = `Batch: 0 / ${Math.ceil(parsedArticles.length / 20)}`;

  chrome.runtime.sendMessage<ExtensionMessage, { success: boolean; error?: string }>(
    { type: 'START_UPLOAD', articles: parsedArticles },
    (response) => {
      if (!response || !response.success) {
        handleUploadError(response?.error || 'Failed to start upload in background service worker');
      }
    }
  );
});

function handleUploadProgress(progress: UploadProgressUpdate): void {
  uploadProgressSection.classList.remove('hidden');
  uploadProgressBar.style.width = `${progress.progressPercent}%`;
  uploadProgressStatus.textContent = progress.message;
  uploadProgressPct.textContent = `${progress.progressPercent}%`;
  uploadStatCount.textContent = `Indexed: ${progress.processedCount} / ${progress.totalCount}`;
  uploadStatBatches.textContent = `Batch: ${progress.currentBatch} / ${progress.totalBatches}`;
  setSyncState('syncing', `Uploading (${progress.progressPercent}%)`);
}

function handleUploadCompleted(result: unknown): void {
  uploadProgressSection.classList.remove('hidden');
  uploadProgressBar.style.width = '100%';
  uploadProgressStatus.textContent = 'Ingestion complete!';
  uploadProgressPct.textContent = '100%';

  const res = result as { addedCount?: number; updatedCount?: number; totalProcessed?: number; elapsedMs?: number } | undefined;
  const processed = res?.totalProcessed ?? parsedArticles.length;
  const added = res?.addedCount ?? 0;
  const updated = res?.updatedCount ?? 0;
  const elapsed = res?.elapsedMs ? (res.elapsedMs / 1000).toFixed(1) : '0';

  uploadParseStatus.className = 'test-result-box success';
  uploadParseStatus.textContent = `✔ Successfully indexed ${processed} articles (${added} new, ${updated} updated) in ${elapsed}s.`;
  uploadParseStatus.classList.remove('hidden');

  btnStartUpload.disabled = false;
  btnStartUpload.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="23 4 23 10 17 10"></polyline>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>
    Ingest Again
  `;

  setSyncState('synced', 'Up to date');
  refreshSyncStatus();
}

function handleUploadError(error: string): void {
  uploadProgressSection.classList.add('hidden');
  uploadParseStatus.className = 'test-result-box error';
  uploadParseStatus.textContent = `Upload failed: ${error}`;
  uploadParseStatus.classList.remove('hidden');
  btnStartUpload.disabled = false;
  setSyncState('behind', 'Upload error');
}

// Helpers
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSimpleMarkdown(md: string): string {
  if (!md) return '';
  const parsed = marked.parse(md, { gfm: true, breaks: true }) as string;
  return parsed.replace(/\[(\d+)\]/g, '<span class="citation-badge">[$1]</span>');
}
