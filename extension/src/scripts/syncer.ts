import { probeSakaHub, fetchSakaHubPage, sleep } from './sakahub-api.js';
import { cleanWordHtmlToMarkdown } from './turndown-cleaner.js';
import {
  SakaNormalizedArticle,
  BackendSyncStatus,
  StalenessCheckResult,
  SyncProgressUpdate,
  ChangedArticlePayload,
  ReindexBatchRequest,
} from '../types.js';

const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const MAX_BATCH_TEXT_CHARS = 1000000; // ~1 MB of clean Markdown text
const MAX_BATCH_ARTICLES = 20;

export async function getBackendUrl(): Promise<string> {
  const result = await chrome.storage.local.get(['backendUrl']);
  return typeof result.backendUrl === 'string' ? result.backendUrl : DEFAULT_BACKEND_URL;
}

export async function getClientId(): Promise<string> {
  const result = await chrome.storage.local.get(['clientId']);
  if (typeof result.clientId === 'string') return result.clientId;

  const newId = `ext_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  await chrome.storage.local.set({ clientId: newId });
  return newId;
}

function isBackendSyncStatus(data: unknown): data is BackendSyncStatus {
  return (
    typeof data === 'object' &&
    data !== null &&
    'totalIndexed' in data &&
    typeof (data as Record<string, unknown>).totalIndexed === 'number'
  );
}

/**
 * Checks whether the backend is behind SakaHub by comparing probe counts and timestamps.
 */
export async function checkStaleness(): Promise<StalenessCheckResult> {
  const backendUrl = await getBackendUrl();

  // 1. Fetch backend sync-status
  const backendRes = await fetch(`${backendUrl}/sync-status`);
  if (!backendRes.ok) {
    throw new Error(`Failed to reach backend sync-status: HTTP ${backendRes.status}`);
  }
  const backendData: unknown = await backendRes.json();
  if (!isBackendSyncStatus(backendData)) {
    throw new Error('Invalid sync status structure received from backend');
  }

  // 2. Probe SakaHub
  const sakaProbe = await probeSakaHub();

  const totalIndexed = backendData.totalIndexed;
  const maxLastUpdated = backendData.maxLastUpdated;
  const isSyncing = backendData.isSyncing;

  let isBehind = false;
  let reason = '';

  if (totalIndexed === 0 && sakaProbe.totalElements > 0) {
    isBehind = true;
    reason = 'Initial indexing required (0 indexed articles in backend).';
  } else if (sakaProbe.totalElements !== totalIndexed) {
    isBehind = true;
    reason = `Article count mismatch (SakaHub: ${sakaProbe.totalElements}, Backend: ${totalIndexed}).`;
  } else if (
    sakaProbe.newestLastUpdated &&
    maxLastUpdated &&
    new Date(sakaProbe.newestLastUpdated) > new Date(maxLastUpdated)
  ) {
    isBehind = true;
    reason = `Newer article detected on SakaHub (${sakaProbe.newestLastUpdated} > ${maxLastUpdated}).`;
  }

  return {
    isBehind,
    isSyncing,
    reason,
    sakaCount: sakaProbe.totalElements,
    backendCount: totalIndexed,
    newestSakaDate: sakaProbe.newestLastUpdated,
    maxBackendDate: maxLastUpdated,
  };
}

/**
 * Executes full synchronization with client-side Turndown and size-capped batching.
 */
export async function performFullSync(
  onProgress?: (update: SyncProgressUpdate) => void
): Promise<{
  synced: boolean;
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
  message: string;
}> {
  const backendUrl = await getBackendUrl();
  const clientId = await getClientId();

  const notify = (update: SyncProgressUpdate) => {
    if (onProgress) onProgress(update);
    chrome.storage.local.set({ syncProgress: update }).catch(() => {});
  };

  notify({
    stage: 'probing',
    message: 'Probing SakaHub and Backend status...',
    progressPercent: 5,
  });

  // Step 1: Acquire lock
  notify({
    stage: 'locking',
    message: 'Acquiring backend sync lock...',
    progressPercent: 10,
  });

  const lockRes = await fetch(`${backendUrl}/sync/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId }),
  });

  if (!lockRes.ok) {
    const errJson: unknown = await lockRes.json();
    const errMsg =
      typeof errJson === 'object' && errJson !== null && 'message' in errJson
        ? String((errJson as Record<string, unknown>).message)
        : 'Could not acquire sync lock. Another sync is active.';
    throw new Error(errMsg);
  }

  try {
    // Step 2: Fetch known versions from backend
    notify({
      stage: 'scraping',
      message: 'Fetching known article versions from backend...',
      progressPercent: 15,
    });

    const versionsRes = await fetch(`${backendUrl}/articles/versions`);
    if (!versionsRes.ok) {
      throw new Error(`Failed to fetch article versions: HTTP ${versionsRes.status}`);
    }
    const rawVersions: unknown = await versionsRes.json();
    const backendVersions =
      typeof rawVersions === 'object' && rawVersions !== null
        ? (rawVersions as Record<string, string>)
        : {};

    // Step 3: Page through SakaHub at size=152
    notify({
      stage: 'scraping',
      message: 'Starting SakaHub article sweep (page size 152)...',
      progressPercent: 20,
    });

    const page0 = await fetchSakaHubPage(0, 152);
    const totalPages =
      page0.totalPages ||
      (page0.totalElements ? Math.ceil(page0.totalElements / 152) : 1);
    const allSakaArticles: SakaNormalizedArticle[] = [...page0.articles];

    for (let p = 1; p < totalPages; p++) {
      await sleep(250);

      notify({
        stage: 'scraping',
        message: `Scraping SakaHub articles: page ${p + 1} of ${totalPages}...`,
        progressPercent: Math.round(20 + ((p + 1) / totalPages) * 35),
      });

      const pageData = await fetchSakaHubPage(p, 152);
      allSakaArticles.push(...pageData.articles);
    }

    // Step 4: Compute exact set differences
    notify({
      stage: 'cleaning',
      message: 'Computing set differences and normalizing HTML to Markdown...',
      progressPercent: 60,
    });

    const sakahubMap = new Map<string, SakaNormalizedArticle>(allSakaArticles.map((a) => [a.id, a]));
    const backendIds = new Set(Object.keys(backendVersions));

    const added: SakaNormalizedArticle[] = [];
    const updated: SakaNormalizedArticle[] = [];
    const deletedIds: string[] = [];

    for (const [id, article] of sakahubMap.entries()) {
      if (!backendIds.has(id)) {
        added.push(article);
      } else {
        const backendDate = new Date(backendVersions[id] || 0).getTime();
        const sakaDate = article.updatedAtEpochMs;
        // Ignore sub-second timestamp jitter between DB and API
        if (Math.abs(sakaDate - backendDate) >= 1000) {
          updated.push(article);
        }
      }
    }

    for (const backendId of backendIds) {
      if (!sakahubMap.has(backendId)) {
        deletedIds.push(backendId);
      }
    }

    const changedArticles = [...added, ...updated];
    console.log(`[Sync Diff] Added: ${added.length}, Updated: ${updated.length}, Deleted: ${deletedIds.length}`);

    if (changedArticles.length === 0 && deletedIds.length === 0) {
      notify({
        stage: 'completed',
        message: 'No changes detected. Knowledge base is fully up to date.',
        progressPercent: 100,
      });
      return {
        synced: true,
        addedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        message: 'Already up to date',
      };
    }

    // Step 5: Clean Word HTML to Markdown with Turndown + GFM and upload in batches
    notify({
      stage: 'uploading',
      message: `Uploading ${changedArticles.length} changed articles and ${deletedIds.length} deletions in batches...`,
      progressPercent: 70,
    });

    let currentBatch: ChangedArticlePayload[] = [];
    let currentBatchChars = 0;
    let uploadedChanged = 0;
    let isFirstBatch = true;

    async function dispatchBatch() {
      if (currentBatch.length === 0 && (!isFirstBatch || deletedIds.length === 0)) return;

      const batchPayload: ReindexBatchRequest = {
        changed: currentBatch,
        deletedIds: isFirstBatch ? deletedIds : [],
        clientId,
      };

      const res = await fetch(`${backendUrl}/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchPayload),
      });

      if (!res.ok) {
        const err: unknown = await res.json();
        const errDetail =
          typeof err === 'object' && err !== null && 'message' in err
            ? String((err as Record<string, unknown>).message)
            : `Reindex batch failed with status ${res.status}`;
        throw new Error(errDetail);
      }

      uploadedChanged += currentBatch.length;
      isFirstBatch = false;
      currentBatch = [];
      currentBatchChars = 0;
    }

    for (let i = 0; i < changedArticles.length; i++) {
      const art = changedArticles[i];
      if (!art) continue;

      const cleanMarkdown = cleanWordHtmlToMarkdown(art.contentHtml);

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
        notify({
          stage: 'uploading',
          message: `Indexed ${uploadedChanged} of ${changedArticles.length} articles...`,
          progressPercent: Math.round(70 + (uploadedChanged / changedArticles.length) * 25),
        });
      }
    }

    await dispatchBatch();

    // Step 6: Unlock
    await fetch(`${backendUrl}/sync/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });

    const completionSummary: SyncProgressUpdate = {
      stage: 'completed',
      message: `Sync completed: ${added.length} added, ${updated.length} updated, ${deletedIds.length} deleted.`,
      progressPercent: 100,
    };
    notify(completionSummary);

    await chrome.storage.local.set({
      lastSyncedAt: new Date().toISOString(),
      lastSyncSummary: completionSummary.message,
    });

    return {
      synced: true,
      addedCount: added.length,
      updatedCount: updated.length,
      deletedCount: deletedIds.length,
      message: completionSummary.message,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Sync Error]', error);
    notify({
      stage: 'error',
      message: `Sync failed: ${errorMsg}`,
      progressPercent: 0,
    });

    try {
      await fetch(`${backendUrl}/sync/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
    } catch {}

    throw error;
  }
}
