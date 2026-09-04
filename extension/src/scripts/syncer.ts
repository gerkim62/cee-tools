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
  try {
    const result = await chrome.storage.local.get(['backendUrl']);
    return typeof result.backendUrl === 'string' && result.backendUrl.trim()
      ? result.backendUrl.trim()
      : DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

export async function getClientId(): Promise<string> {
  try {
    const result = await chrome.storage.local.get(['clientId']);
    if (typeof result.clientId === 'string' && result.clientId.trim()) {
      return result.clientId;
    }
    const newId = `inst_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await chrome.storage.local.set({ clientId: newId });
    return newId;
  } catch {
    return `inst_${Date.now()}`;
  }
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
 * Gracefully backs off when unauthenticated or offline without user-facing login alarm.
 */
export async function checkStaleness(force: boolean = false): Promise<StalenessCheckResult> {
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

  const totalIndexed = backendData.totalIndexed;
  const maxLastUpdated = backendData.maxLastUpdated;
  const isSyncing = backendData.isSyncing;

  // If not forcing a check, check if recent probe failed to avoid unnecessary repeated network calls
  if (!force && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const stored = await chrome.storage.local.get(['sakaProbeBackoffUntil']);
      if (stored.sakaProbeBackoffUntil && Date.now() < Number(stored.sakaProbeBackoffUntil)) {
        return {
          isBehind: false,
          isSyncing,
          reason: '',
          sakaCount: totalIndexed,
          backendCount: totalIndexed,
          newestSakaDate: null,
          maxBackendDate: maxLastUpdated,
        };
      }
    } catch { }
  }

  // 2. Probe SakaHub (page=0, size=1)
  try {
    const sakaProbe = await probeSakaHub();

    // Probe succeeded: clear any backoff
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(['sakaProbeBackoffUntil']).catch(() => { });
    }

    let isBehind = false;
    let reason = '';

    if (totalIndexed === 0 && sakaProbe.totalElements > 0) {
      isBehind = true;
      reason = 'Initial indexing required.';
    } else if (sakaProbe.totalElements !== totalIndexed) {
      isBehind = true;
      reason = `Article updates detected on SakaHub (${sakaProbe.totalElements} vs ${totalIndexed} indexed).`;
    } else if (
      sakaProbe.newestLastUpdated &&
      maxLastUpdated &&
      new Date(sakaProbe.newestLastUpdated) > new Date(maxLastUpdated)
    ) {
      isBehind = true;
      reason = 'Newer article revisions detected on SakaHub.';
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
  } catch (err: unknown) {
    // When probe returns 401 or offline, back off for 15 minutes and suppress background errors
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ sakaProbeBackoffUntil: Date.now() + 15 * 60 * 1000 }).catch(() => { });
    }

    // When explicitly forced (e.g. user clicked Sync), do NOT pretend it succeeded!
    if (force) {
      throw err;
    }

    return {
      isBehind: false,
      isSyncing,
      reason: '',
      sakaCount: totalIndexed,
      backendCount: totalIndexed,
      newestSakaDate: null,
      maxBackendDate: maxLastUpdated,
    };
  }
}

/**
 * Strategy 1: Hybrid Early-Exit + Conditional Full Sweep
 * - If mode is 'deep' or deletions detected (sakaCount < backendCount), executes a full sweep of all pages.
 * - Otherwise (routine updates/additions), fetches page by page stopping early as soon as articles
 *   older than the backend's maxLastUpdated are encountered, saving 85%+ network bandwidth.
 */
export async function performSmartSync(
  mode: 'smart' | 'deep' = 'smart',
  onProgress?: (update: SyncProgressUpdate) => void,
  force: boolean = true
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
    chrome.storage.local.set({ syncProgress: update }).catch(() => { });
  };

  notify({
    stage: 'probing',
    message: 'Checking SakaHub & backend status...',
    progressPercent: 5,
  });

  // Step 1: Probe backend & SakaHub (force=true when user explicitly triggers sync)
  const probeStatus = await checkStaleness(force);

  // Step 2: Acquire backend lock
  notify({
    stage: 'locking',
    message: 'Acquiring sync lock on backend...',
    progressPercent: 10,
  });

  const lockRes = await fetch(`${backendUrl}/sync/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId }),
  });

  if (!lockRes.ok) {
    const errJson: unknown = await lockRes.json().catch(() => ({}));
    const errMsg =
      typeof errJson === 'object' && errJson !== null && 'message' in errJson
        ? String((errJson as Record<string, unknown>).message)
        : 'Could not acquire sync lock. Another sync is active.';
    throw new Error(errMsg);
  }

  try {
    // Step 3: Fetch known versions from backend
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

    const backendIds = new Set(Object.keys(backendVersions));
    const backendMaxDateMs = probeStatus.maxBackendDate
      ? new Date(probeStatus.maxBackendDate).getTime()
      : 0;

    // Determine sweep strategy
    const isDeletionExpected = probeStatus.sakaCount < probeStatus.backendCount;
    const isFullSweepRequired = mode === 'deep' || isDeletionExpected || probeStatus.backendCount === 0;

    console.log(
      `[Sync] Strategy: ${isFullSweepRequired ? 'FULL SWEEP' : 'EARLY-EXIT WATERFALL'} (mode: ${mode}, deletionsExpected: ${isDeletionExpected})`
    );

    const changedArticles: SakaNormalizedArticle[] = [];
    const deletedIds: string[] = [];
    let addedCount = 0;
    let updatedCount = 0;

    if (isFullSweepRequired) {
      // Full page sweep across all pages (page size 152)
      notify({
        stage: 'scraping',
        message: 'Sweeping all SakaHub articles for complete reconciliation...',
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
          message: `Sweeping SakaHub: page ${p + 1} of ${totalPages}...`,
          progressPercent: Math.round(20 + ((p + 1) / totalPages) * 35),
        });
        const pageData = await fetchSakaHubPage(p, 152);
        allSakaArticles.push(...pageData.articles);
      }

      const sakahubMap = new Map<string, SakaNormalizedArticle>(allSakaArticles.map((a) => [a.id, a]));

      for (const [id, article] of sakahubMap.entries()) {
        if (!backendIds.has(id)) {
          changedArticles.push(article);
          addedCount++;
        } else {
          const backendDate = new Date(backendVersions[id] || 0).getTime();
          if (Math.abs(article.updatedAtEpochMs - backendDate) >= 1000) {
            changedArticles.push(article);
            updatedCount++;
          }
        }
      }

      for (const backendId of backendIds) {
        if (!sakahubMap.has(backendId)) {
          deletedIds.push(backendId);
        }
      }
    } else {
      // Early-Exit Waterfall: Paging stops as soon as an article's updatedAt <= backendMaxDateMs
      notify({
        stage: 'scraping',
        message: 'Checking newest SakaHub articles (early-exit mode)...',
        progressPercent: 25,
      });

      let pageIndex = 0;
      let shouldContinuePaging = true;

      while (shouldContinuePaging) {
        const pageData = await fetchSakaHubPage(pageIndex, 152);
        if (pageData.articles.length === 0) break;

        for (const article of pageData.articles) {
          if (!backendIds.has(article.id)) {
            changedArticles.push(article);
            addedCount++;
          } else {
            const backendDate = new Date(backendVersions[article.id] || 0).getTime();
            if (article.updatedAtEpochMs > backendDate + 1000) {
              changedArticles.push(article);
              updatedCount++;
            } else if (article.updatedAtEpochMs <= backendMaxDateMs) {
              // Reached articles older than or equal to our DB max timestamp
              shouldContinuePaging = false;
              break;
            }
          }
        }

        pageIndex++;
        const totalPages = pageData.totalPages || 1;
        if (pageIndex >= totalPages) {
          shouldContinuePaging = false;
        } else if (shouldContinuePaging) {
          await sleep(200);
          notify({
            stage: 'scraping',
            message: `Inspecting page ${pageIndex + 1} for changed articles...`,
            progressPercent: Math.min(55, 25 + pageIndex * 10),
          });
        }
      }
    }

    console.log(
      `[Sync Diff] Added: ${addedCount}, Updated: ${updatedCount}, Deleted: ${deletedIds.length}`
    );

    if (changedArticles.length === 0 && deletedIds.length === 0) {
      if (probeStatus.backendCount === 0) {
        throw new Error('Please open SakaHub in your browser and it will automatically pick up.');
      }

      const upToDateMsg = 'Knowledge base is completely up to date. No changes needed.';
      notify({
        stage: 'completed',
        message: upToDateMsg,
        progressPercent: 100,
        processedCount: 0,
        totalCount: 0,
      });
      await fetch(`${backendUrl}/sync/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      }).catch(() => { });
      return {
        synced: true,
        addedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        message: upToDateMsg,
      };
    }

    // Step 5: Clean Word HTML to Markdown & Batch Ingestion to /reindex
    notify({
      stage: 'cleaning',
      message: `Preparing ${changedArticles.length} changed articles and ${deletedIds.length} deletions...`,
      progressPercent: 60,
    });

    const totalBatchesEstimated = Math.max(1, Math.ceil(changedArticles.length / MAX_BATCH_ARTICLES));
    let currentBatch: ChangedArticlePayload[] = [];
    let currentBatchChars = 0;
    let uploadedChanged = 0;
    let isFirstBatch = true;
    let batchNum = 0;

    async function dispatchBatch() {
      if (currentBatch.length === 0 && (!isFirstBatch || deletedIds.length === 0)) return;
      batchNum++;

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
        const err: unknown = await res.json().catch(() => ({}));
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

      const pct = Math.min(99, Math.round(65 + (uploadedChanged / Math.max(1, changedArticles.length)) * 32));
      notify({
        stage: 'uploading',
        message: `Indexed batch ${batchNum} of ~${totalBatchesEstimated} (${uploadedChanged}/${changedArticles.length} articles)...`,
        progressPercent: pct,
        processedCount: uploadedChanged,
        totalCount: changedArticles.length,
        currentBatch: batchNum,
        totalBatches: totalBatchesEstimated,
      });
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
      }
    }

    await dispatchBatch();

    // Step 6: Unlock
    await fetch(`${backendUrl}/sync/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    }).catch(() => { });

    const summaryMsg = `Sync complete: ${addedCount} added, ${updatedCount} updated, ${deletedIds.length} deleted.`;
    notify({
      stage: 'completed',
      message: summaryMsg,
      progressPercent: 100,
      addedCount,
      updatedCount,
      deletedCount: deletedIds.length,
      processedCount: uploadedChanged,
      totalCount: changedArticles.length,
    });

    await chrome.storage.local.set({
      lastSyncedAt: new Date().toISOString(),
      lastSyncSummary: summaryMsg,
    });

    return {
      synced: true,
      addedCount,
      updatedCount,
      deletedCount: deletedIds.length,
      message: summaryMsg,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Syncer Error]', err);

    const userFriendlyMsg =
      errorMsg.includes('SAKAHUB_AUTH') ||
        errorMsg.includes('401') ||
        errorMsg.includes('redirect') ||
        errorMsg.includes('portal') ||
        errorMsg.includes('signed in') ||
        errorMsg.includes('session') ||
        errorMsg.includes('automatically pick') ||
        errorMsg.includes('No articles could be read')
        ? 'Please open SakaHub in your browser and it will automatically pick up.'
        : `Sync failed: ${errorMsg}`;

    notify({
      stage: 'error',
      message: userFriendlyMsg,
      progressPercent: 0,
    });

    try {
      await fetch(`${backendUrl}/sync/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
    } catch { }

    throw new Error(userFriendlyMsg);
  }
}
