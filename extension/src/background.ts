import { checkStaleness, performSmartSync, getBackendUrl } from './scripts/syncer.js';
import {
  ExtensionMessage,
  SyncProgressUpdate,
  AskStreamClientMessage,
} from './types.js';

let isSyncInProgress = false;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Ask Saka ready.');
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET' });
    } catch {
      // Content script might not be injected on restricted pages (e.g. chrome://)
    }
  }
});

async function updateBadge(text: string, color: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch (err) {
    console.warn('[Badge Error]', err);
  }
}

async function broadcastMessage(msg: ExtensionMessage): Promise<void> {
  // Broadcast to tabs (where content script widgets live)
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    }
  } catch {}
  // Also runtime message
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function runStalenessCheck(force: boolean = false): Promise<void> {
  if (isSyncInProgress) return;
  try {
    const status = await checkStaleness(force);
    if (status.isBehind) {
      await updateBadge('SYNC', '#f59e0b');
    } else {
      await updateBadge('', '#10b981');
    }
    await broadcastMessage({
      type: 'SYNC_PROGRESS',
      progress: {
        stage: status.isBehind ? 'probing' : 'idle',
        message: status.isBehind ? 'New articles detected on SakaHub' : 'Knowledge base is up to date',
        progressPercent: status.isBehind ? 0 : 100,
        details: { isBehind: status.isBehind, reason: status.reason },
      },
    });
  } catch (err) {
    console.debug('[Background Staleness Check]', err);
  }
}

// ----------------------------------------------------
// Message Bus for One-off Requests & Proxy Fetch (Zero CORS)
// ----------------------------------------------------
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    if (message.type === 'BG_FETCH') {
      const { url, options } = message;
      fetch(url, options)
        .then(async (res) => {
          const ok = res.ok;
          const status = res.status;
          let data: any = null;
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              data = await res.json();
            } catch {
              data = null;
            }
          } else {
            data = await res.text();
          }
          sendResponse({ success: true, ok, status, data });
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        });
      return true;
    }

    if (message.type === 'CHECK_STALENESS') {
      checkStaleness()
        .then((res) => sendResponse({ success: true, data: res }))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        });
      return true;
    }

    if (message.type === 'START_SYNC') {
      if (isSyncInProgress) {
        sendResponse({ success: false, error: 'A synchronization is already actively running.' });
        return false;
      }

      isSyncInProgress = true;
      const mode = message.mode || 'smart';
      updateBadge('...', '#3b82f6');

      performSmartSync(mode, (progress: SyncProgressUpdate) => {
        broadcastMessage({ type: 'SYNC_PROGRESS', progress });
        if (progress.progressPercent) {
          updateBadge(`${progress.progressPercent}%`, '#3b82f6');
        }
      })
        .then((result) => {
          isSyncInProgress = false;
          updateBadge('OK', '#10b981');
          setTimeout(() => updateBadge('', '#10b981'), 5000);
          broadcastMessage({ type: 'SYNC_COMPLETED', result });
        })
        .catch((err: unknown) => {
          isSyncInProgress = false;
          const msg = err instanceof Error ? err.message : String(err);
          updateBadge('ERR', '#ef4444');
          broadcastMessage({ type: 'SYNC_ERROR', error: msg });
        });

      sendResponse({ success: true, message: `Sync started in ${mode} mode` });
      return true;
    }

    if (message.type === 'GET_SYNC_STATE') {
      sendResponse({ isSyncInProgress });
      return false;
    }
  }
);

// ----------------------------------------------------
// Long-lived Port for /ask SSE Streaming (Zero CORS)
// ----------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ASK_STREAM') return;

  let abortController: AbortController | null = null;

  port.onDisconnect.addListener(() => {
    if (abortController) {
      abortController.abort();
    }
  });

  port.onMessage.addListener(async (clientMsg: AskStreamClientMessage) => {
    if (clientMsg.type === 'START_ASK') {
      abortController = new AbortController();
      try {
        const backendUrl = await getBackendUrl();
        const res = await fetch(`${backendUrl}/ask`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            question: clientMsg.question,
            conversationId: clientMsg.conversationId,
            clientId: clientMsg.clientId,
            stream: true,
          }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          port.postMessage({
            type: 'error',
            message: errJson.message || `Server error (HTTP ${res.status})`,
          });
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          port.postMessage({ type: 'error', message: 'No readable stream available' });
          return;
        }

        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let currentEvent = 'message';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.slice(6).trim();
            } else if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim();
              try {
                const data = JSON.parse(dataStr);
                if (currentEvent === 'status') {
                  port.postMessage({
                    type: 'status',
                    message: data.message,
                    label: data.label,
                    detail: data.detail,
                    step: data.step,
                  });
                } else if (currentEvent === 'token') {
                  port.postMessage({ type: 'token', delta: data.delta });
                } else if (currentEvent === 'citations') {
                  port.postMessage({ type: 'citations', citations: data.citations });
                } else if (currentEvent === 'done') {
                  port.postMessage({
                    type: 'done',
                    answer: data.answer,
                    citations: data.citations,
                    conversationId: data.conversationId,
                    executionSteps: data.executionSteps,
                  });
                } else if (currentEvent === 'error') {
                  port.postMessage({ type: 'error', message: data.message });
                }
              } catch {}
            }
          }
        }
      } catch (err: unknown) {
        if ((err as any)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : String(err);
        port.postMessage({ type: 'error', message: msg });
      }
    }
  });
});
