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

// ----------------------------------------------------
// Message Bus for One-off Requests & Proxy Fetch (Zero CORS)
// ----------------------------------------------------
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    if (message.type === 'BG_FETCH') {
      const { url, options } = message;
      fetch(url, options)
        .then(async (res) => {
          const ok = res.ok;
          const status = res.status;
          let data: unknown = null;
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
            parentId: clientMsg.parentId,
            retryUserMessageId: clientMsg.retryUserMessageId,
            stream: true,
          }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          const errMsg =
            typeof errJson === 'object' && errJson !== null && 'message' in errJson && typeof errJson.message === 'string'
              ? errJson.message
              : `Server error (HTTP ${res.status})`;
          port.postMessage({
            type: 'error',
            message: errMsg,
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
                if (typeof data !== 'object' || data === null) continue;

                if (currentEvent === 'status') {
                  port.postMessage({
                    type: 'status',
                    message: 'message' in data && typeof data.message === 'string' ? data.message : '',
                    label: 'label' in data && typeof data.label === 'string' ? data.label : undefined,
                    detail: 'detail' in data && typeof data.detail === 'string' ? data.detail : undefined,
                    step: 'step' in data && typeof data.step === 'string' ? data.step : undefined,
                  });
                } else if (currentEvent === 'token') {
                  const delta =
                    'delta' in data && typeof data.delta === 'string'
                      ? data.delta
                      : 'token' in data && typeof data.token === 'string'
                        ? data.token
                        : '';
                  port.postMessage({ type: 'token', delta });
                } else if (currentEvent === 'citations') {
                  port.postMessage({
                    type: 'citations',
                    citations: 'citations' in data && Array.isArray(data.citations) ? data.citations : [],
                  });
                } else if (currentEvent === 'done') {
                  port.postMessage({
                    type: 'done',
                    answer: 'answer' in data && typeof data.answer === 'string' ? data.answer : undefined,
                    citations: 'citations' in data && Array.isArray(data.citations) ? data.citations : undefined,
                    conversationId: 'conversationId' in data && typeof data.conversationId === 'string' ? data.conversationId : undefined,
                    conversationTitle: 'conversationTitle' in data && typeof data.conversationTitle === 'string' ? data.conversationTitle : undefined,
                    executionSteps: 'executionSteps' in data && Array.isArray(data.executionSteps) ? data.executionSteps : undefined,
                    clarifyingQuestion: 'clarifyingQuestion' in data && typeof data.clarifyingQuestion === 'object' && data.clarifyingQuestion !== null ? data.clarifyingQuestion : undefined,
                    suggestedFollowUps: 'suggestedFollowUps' in data && Array.isArray(data.suggestedFollowUps) ? data.suggestedFollowUps : undefined,
                    messageId: 'messageId' in data && typeof data.messageId === 'string' ? data.messageId : undefined,
                    userMessageId: 'userMessageId' in data && typeof data.userMessageId === 'string' ? data.userMessageId : undefined,
                    parentId: 'parentId' in data && typeof data.parentId === 'string' ? data.parentId : ('parentId' in data && data.parentId === null ? null : undefined),
                  });
                } else if (currentEvent === 'error') {
                  const errMsg = 'message' in data && typeof data.message === 'string' ? data.message : 'Unknown error';
                  port.postMessage({ type: 'error', message: errMsg });
                }
              } catch {}
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : String(err);
        port.postMessage({ type: 'error', message: msg });
      }
    }
  });
});
