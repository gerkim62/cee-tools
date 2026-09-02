import { AskResponse, Citation, ExtensionMessage, StalenessCheckResult, SyncProgressUpdate } from '../types.js';

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
const btnCopy = requireElement('btn-copy-answer', HTMLButtonElement);

// Settings Elements
const btnSettingsToggle = requireElement('btn-settings-toggle', HTMLButtonElement);
const settingsModal = requireElement('settings-modal', HTMLDivElement);
const btnCloseSettings = requireElement('btn-close-settings', HTMLButtonElement);
const inputBackendUrl = requireElement('input-backend-url', HTMLInputElement);
const btnTestConnection = requireElement('btn-test-connection', HTMLButtonElement);
const btnSaveSettings = requireElement('btn-save-settings', HTMLButtonElement);
const connectionTestResult = requireElement('connection-test-result', HTMLDivElement);

let activeBackendUrl = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['backendUrl']);
  if (typeof stored.backendUrl === 'string') {
    activeBackendUrl = stored.backendUrl;
  }
  inputBackendUrl.value = activeBackendUrl;

  refreshSyncStatus();
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

  try {
    const response = await fetch(`${activeBackendUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      const errJson: unknown = await response.json();
      const message =
        typeof errJson === 'object' && errJson !== null && 'message' in errJson
          ? String((errJson as Record<string, unknown>).message)
          : `Server returned ${response.status}`;
      throw new Error(message);
    }

    const data: unknown = await response.json();
    if (typeof data === 'object' && data !== null && 'answer' in data) {
      displayAnswer(data as AskResponse);
    } else {
      throw new Error('Malformed answer format received from backend');
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

  const citations = data.citations || [];
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
  let html = escapeHtml(md);

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[(\d+)\]/g, '<span class="citation-badge">[$1]</span>');
  html = html.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

  return html;
}
