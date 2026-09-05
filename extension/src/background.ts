import { checkStaleness, performSmartSync, getBackendUrl } from './scripts/syncer.js';
import { fetchSakaSession } from './scripts/sakahub-api.js';
import {
  ExtensionMessage,
  SyncProgressUpdate,
  AskStreamClientMessage,
  AgentChannel,
} from './types.js';

let isSyncInProgress = false;
let lastSakaHubTabId: number | null = null;
let activeWorkstationWindowId: number | null = null;
let activeWorkstationTabId: number | null = null;
let activeWorkstationConversationId: string | null = null;

function reopenBrowserConversation(): void {
  const targetTabId = lastSakaHubTabId;
  if (typeof targetTabId === 'number') {
    chrome.tabs.get(targetTabId).then(async (tab) => {
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      await chrome.tabs.update(targetTabId, { active: true }).catch(() => {});
      chrome.tabs.sendMessage(targetTabId, {
        type: 'EXPAND_WIDGET',
        conversationId: activeWorkstationConversationId ?? undefined,
      }).catch(() => {});
    }).catch(() => {});
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === activeWorkstationWindowId) {
    activeWorkstationWindowId = null;
    reopenBrowserConversation();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeWorkstationTabId) {
    activeWorkstationTabId = null;
    reopenBrowserConversation();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Ask Saka ready.');
});

chrome.action.onClicked.addListener(async (tab) => {
  const isRestrictedUrl = (url?: string) => {
    if (!url) return true;
    return (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:') ||
      url.startsWith('view-source:') ||
      url.includes('chromewebstore.google.com') ||
      url.includes('chrome.google.com/webstore')
    );
  };

  const openFallbackMode = async () => {
    try {
      const stored = await chrome.storage.local.get(['saka_last_open_mode', 'saka_window_bounds']);
      const mode = stored.saka_last_open_mode || 'window';
      const bounds = stored.saka_window_bounds || { width: 1150, height: 750 };
      const targetWidth = Math.min(Math.max(900, bounds.width || 1150), 1350);
      const targetHeight = Math.min(Math.max(650, bounds.height || 750), 850);

      if (mode === 'tab') {
        const url = chrome.runtime.getURL('window.html?mode=tab');
        await chrome.tabs.create({ url, active: true });
        return;
      }

      // Default fallback is dedicated popup window
      const url = chrome.runtime.getURL('window.html');
      if (activeWorkstationWindowId) {
        try {
          const existingWin = await chrome.windows.get(activeWorkstationWindowId);
          if (existingWin) {
            await chrome.windows.update(activeWorkstationWindowId, { focused: true });
            return;
          }
        } catch {
          activeWorkstationWindowId = null;
        }
      }

      const win = await chrome.windows.create({
        url,
        type: 'popup',
        state: 'normal',
        width: targetWidth,
        height: targetHeight,
        left: bounds.left,
        top: bounds.top,
        focused: true,
      });
      activeWorkstationWindowId = win.id ?? null;
    } catch (err) {
      console.warn('[Background] Failed to open fallback window:', err);
    }
  };

  if (!tab.id || isRestrictedUrl(tab.url)) {
    await openFallbackMode();
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET' });
    chrome.storage.local.set({ saka_last_open_mode: 'widget' }).catch(() => {});
  } catch {
    // Content script might not be injected or page cannot run content scripts
    await openFallbackMode();
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

    if (message.type === 'CHECK_SAKAHUB_SESSION') {
      fetchSakaSession()
        .then(async (session) => {
          const dept = String(session.user?.department || '').trim();
          const jobTitle = String(session.user?.jobTitle || '').trim();
          const lowerDept = dept.toLowerCase();
          const lowerJob = jobTitle.toLowerCase();

          const isRetail =
            lowerDept.includes('retail') ||
            lowerDept.includes('shop') ||
            lowerDept.includes('franchise') ||
            lowerDept.includes('store') ||
            lowerJob.includes('retail') ||
            lowerJob.includes('shop') ||
            lowerJob.includes('franchise');

          const detectedChannel: AgentChannel = isRetail ? 'retail' : 'care_center';

          await chrome.storage.local.set({
            saka_agent_channel: detectedChannel,
            saka_role_detected: true,
            saka_user_department: dept,
            saka_user_job_title: jobTitle,
            saka_user_roles: Array.isArray(session.user?.roles) ? session.user.roles : [],
          });

          sendResponse({
            success: true,
            connected: true,
            channel: detectedChannel,
            department: dept,
            message: `Role: ${detectedChannel === 'retail' ? 'Retail Shop' : 'Call Center'}${dept ? ` (${dept})` : ''}`,
          });
        })
        .catch(() => {
          sendResponse({
            success: false,
            connected: false,
            message: 'Please open SakaHub in your browser, then return here.',
          });
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

    if (message.type === 'OPEN_DEDICATED_WINDOW') {
      if (_sender.tab?.id) {
        lastSakaHubTabId = _sender.tab.id;
      }
      const conversationId = message.conversationId;
      if (conversationId) {
        activeWorkstationConversationId = conversationId;
      }
      chrome.storage.local.get(['saka_window_bounds']).then(async (stored) => {
        const bounds = stored.saka_window_bounds || { width: 1150, height: 750 };
        const targetWidth = Math.min(Math.max(900, bounds.width || 1150), 1350);
        const targetHeight = Math.min(Math.max(650, bounds.height || 750), 850);
        const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
        const url = chrome.runtime.getURL(`window.html${query}`);

        if (activeWorkstationWindowId) {
          try {
            const existingWin = await chrome.windows.get(activeWorkstationWindowId);
            if (existingWin) {
              await chrome.windows.update(activeWorkstationWindowId, { focused: true });
              const tabs = await chrome.tabs.query({ windowId: activeWorkstationWindowId });
              if (tabs[0]?.id) {
                await chrome.tabs.update(tabs[0].id, { url });
              }
              sendResponse({ success: true, windowId: activeWorkstationWindowId });
              return;
            }
          } catch {
            activeWorkstationWindowId = null;
          }
        }

        const win = await chrome.windows.create({
          url,
          type: 'popup',
          state: 'normal',
          width: targetWidth,
          height: targetHeight,
          left: bounds.left,
          top: bounds.top,
          focused: true,
        });
        activeWorkstationWindowId = win.id ?? null;
        chrome.storage.local.set({ saka_last_open_mode: 'window' }).catch(() => {});
        sendResponse({ success: true, windowId: win.id });
      });
      return true;
    }

    if (message.type === 'OPEN_FULL_TAB') {
      if (_sender.tab?.id) {
        lastSakaHubTabId = _sender.tab.id;
      }
      const conversationId = message.conversationId;
      if (conversationId) {
        activeWorkstationConversationId = conversationId;
      }
      const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}&mode=tab` : '?mode=tab';
      const url = chrome.runtime.getURL(`window.html${query}`);
      chrome.tabs.create({ url, active: true }).then((tab) => {
        activeWorkstationTabId = tab.id ?? null;
        chrome.storage.local.set({ saka_last_open_mode: 'tab' }).catch(() => {});
        sendResponse({ success: true, tabId: tab.id });
      });
      return true;
    }

    if (message.type === 'UPDATE_ACTIVE_CONVERSATION') {
      if (message.conversationId) {
        activeWorkstationConversationId = message.conversationId;
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'FOCUS_SAKAHUB_PAGE') {
      reopenBrowserConversation();
      sendResponse({ success: true });
      return true;
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
            resumeMessageId: clientMsg.resumeMessageId,
            channel: clientMsg.channel,
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
                  const errCode = 'code' in data && typeof data.code === 'string' ? data.code : undefined;
                  const errDetails = 'details' in data && typeof data.details === 'string' ? data.details : undefined;
                  port.postMessage({ type: 'error', message: errMsg, code: errCode, details: errDetails });
                }
              } catch {}
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : String(err);
        port.postMessage({ type: 'error', message: msg, code: 'CONNECTION_ERROR' });
      }
    }
  });
});
