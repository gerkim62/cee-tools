import { checkStaleness, performFullSync } from './scripts/syncer.js';
import { ExtensionMessage, SyncProgressUpdate } from './types.js';

const ALARM_NAME = 'sakahub_staleness_check';
let isSyncInProgress = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: 60,
  });
  console.log('[Background] Installed. Registered periodic staleness alarm.');
  runStalenessCheck();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[Background] Running scheduled staleness check...');
    runStalenessCheck();
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

async function runStalenessCheck(): Promise<void> {
  if (isSyncInProgress) return;
  try {
    const status = await checkStaleness();
    if (status.isBehind) {
      await updateBadge('SYNC', '#f59e0b');
    } else {
      await updateBadge('', '#10b981');
    }
  } catch (err) {
    console.warn('[Background Check Error]', err);
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    if (message.type === 'CHECK_STALENESS') {
      checkStaleness()
        .then(res => sendResponse({ success: true, data: res }))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        });
      return true;
    }

    if (message.type === 'START_SYNC') {
      if (isSyncInProgress) {
        sendResponse({ success: false, error: 'Sync already running' });
        return false;
      }

      isSyncInProgress = true;
      updateBadge('...', '#3b82f6');

      performFullSync((progress: SyncProgressUpdate) => {
        chrome.runtime.sendMessage<ExtensionMessage>({ type: 'SYNC_PROGRESS', progress }).catch(() => {});
        if (progress.progressPercent) {
          updateBadge(`${progress.progressPercent}%`, '#3b82f6');
        }
      })
        .then((result) => {
          isSyncInProgress = false;
          updateBadge('OK', '#10b981');
          setTimeout(() => updateBadge('', '#10b981'), 5000);
          chrome.runtime.sendMessage<ExtensionMessage>({ type: 'SYNC_COMPLETED', result }).catch(() => {});
        })
        .catch((err: unknown) => {
          isSyncInProgress = false;
          const msg = err instanceof Error ? err.message : String(err);
          updateBadge('ERR', '#ef4444');
          chrome.runtime.sendMessage<ExtensionMessage>({ type: 'SYNC_ERROR', error: msg }).catch(() => {});
        });

      sendResponse({ success: true, message: 'Sync started' });
      return true;
    }

    if (message.type === 'GET_SYNC_STATE') {
      sendResponse({ isSyncInProgress });
      return false;
    }
  }
);
