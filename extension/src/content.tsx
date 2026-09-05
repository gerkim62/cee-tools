import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './widget/App.js';
import widgetCss from './widget/widget.css?inline';
import { ExtensionMessage } from './types.js';

// Relay fetch listener: executes inside the page origin so session cookies attach normally
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'SAKAHUB_RELAY_FETCH') {
    (async () => {
      try {
        const response = await fetch(message.url, {
          method: 'GET',
          mode: 'cors',
          credentials: 'include',
          headers: message.options?.headers || {},
        });
        const text = await response.text();
        sendResponse({
          success: true,
          status: response.status,
          redirected: response.redirected,
          url: response.url,
          text,
        });
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true; // keep the message channel open for the async sendResponse
  }
});

function initAskSakaWidget() {
  const HOST_ID = 'ask-saka-widget-host';
  if (document.getElementById(HOST_ID)) return;

  const hostElement = document.createElement('div');
  hostElement.id = HOST_ID;
  document.documentElement.appendChild(hostElement);

  const shadowRoot = hostElement.attachShadow({ mode: 'open' });

  // Encapsulated CSS inside Shadow DOM
  const styleEl = document.createElement('style');
  styleEl.textContent = widgetCss;
  shadowRoot.appendChild(styleEl);

  // Mount React App inside Shadow Root
  const container = document.createElement('div');
  shadowRoot.appendChild(container);

  const root = createRoot(container);
  root.render(<App />);
}

/**
 * Item 17: Saka Article SPA Quote Highlighter
 * Handles dynamic SPA routing where native browser #:~:text gets stripped by router or fails
 * due to async rendering / Microsoft Word bullet artifacts.
 * Uses window.find / Selection API to scroll and highlight the excerpt safely.
 */
function initSakaQuoteHighlighter() {
  function extractTargetFromHash(): string {
    try {
      const hash = window.location.hash;
      if (!hash || !hash.includes(':~:text=')) return '';
      const param = hash.split(':~:text=')[1] || '';
      const firstSegment = param.split('&')[0] || '';
      const startPart = firstSegment.split(',')[0] || '';
      const withoutPrefix = startPart.includes('-,') ? startPart.split('-,')[1] : startPart;
      return decodeURIComponent(withoutPrefix || '');
    } catch {
      return '';
    }
  }

  function getSearchPhrases(rawText: string): string[] {
    if (!rawText) return [];
    // Clean Word list markers, bullets (·, •, middle dot), numbering, normalize non-breaking spaces and quotes
    const clean = rawText
      .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
      .replace(/[\u2018\u2019\u201a\u201b']/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f"]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/^[·•\u00b7\u2022*.\d)(\s-]+/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return [];

    const words = clean.split(' ').filter(Boolean);
    const phrases: string[] = [];

    // Attempt with 4-5 consecutive words first, then 3 words as fallback
    if (words.length >= 4) {
      phrases.push(words.slice(0, 5).join(' '));
      phrases.push(words.slice(0, 4).join(' '));
    } else if (words.length >= 3) {
      phrases.push(words.slice(0, 3).join(' '));
    } else if (words.length > 0) {
      phrases.push(words.join(' '));
    }
    return phrases;
  }

  const runHighlighter = (targetText: string) => {
    const searchPhrases = getSearchPhrases(targetText);
    if (searchPhrases.length === 0) return;

    let isMatched = false;
    const startTime = Date.now();
    const TIMEOUT_MS = 60000; // 60-second observation window for delayed SPAs

    const tryHighlight = (): boolean => {
      if (isMatched) return true;
      let found = false;

      // Try phrases in order of specificity
      for (const phrase of searchPhrases) {
        // @ts-ignore
        if (typeof window.find === 'function' && window.find(phrase, false, false, true, false, false, false)) {
          found = true;
          break;
        }
      }

      if (found) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);

          // Use CSS Custom Highlight API if available (Chrome 105+, zero DOM alteration)
          // @ts-ignore
          if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
            try {
              // @ts-ignore
              const highlight = new Highlight(range);
              // @ts-ignore
              CSS.highlights.set('saka-citation-target', highlight);

              if (!document.getElementById('saka-highlight-style')) {
                const style = document.createElement('style');
                style.id = 'saka-highlight-style';
                style.textContent = `
                  ::highlight(saka-citation-target) {
                    background-color: #fde047 !important;
                    color: #0f172a !important;
                  }
                `;
                document.head.appendChild(style);
              }
            } catch {}
          } else {
            // Fallback: wrap range in mark element
            try {
              const mark = document.createElement('mark');
              mark.style.backgroundColor = '#fde047';
              mark.style.color = '#0f172a';
              mark.style.padding = '2px 4px';
              mark.style.borderRadius = '3px';
              mark.style.boxShadow = '0 0 10px rgba(253, 224, 71, 0.6)';
              range.surroundContents(mark);
            } catch {}
          }

          // Scroll target element smoothly into view
          const element = range.startContainer.parentElement;
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }

          // Clear selection blue overlay so custom highlight shines
          selection.removeAllRanges();
        }

        isMatched = true;
        observer.disconnect();

        // Clean up storage once matched
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.remove(['pendingSakaHighlight']).catch(() => {});
        }
        return true;
      }
      return false;
    };

    // First attempt immediately
    if (tryHighlight()) return;

    // MutationObserver to watch for dynamic DOM insertions from Angular / SakaHub SPA
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (isMatched) return;
      if (Date.now() - startTime > TIMEOUT_MS) {
        observer.disconnect();
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        tryHighlight();
      }, 300);
    });

    try {
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {}

    // Fallback interval polling every 1.5s as safety net
    const intervalId = setInterval(() => {
      if (isMatched || Date.now() - startTime > TIMEOUT_MS) {
        clearInterval(intervalId);
        observer.disconnect();
        return;
      }
      tryHighlight();
    }, 1500);
  };

  // 1. Check storage for citation click from Ask Saka widget
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['pendingSakaHighlight'], (items) => {
      const pending = items.pendingSakaHighlight;
      if (pending && pending.quote && Date.now() - (pending.timestamp || 0) <= 60000) {
        runHighlighter(pending.quote);
        return;
      }

      // 2. Fallback to URL text fragment if present
      const hashTarget = extractTargetFromHash();
      if (hashTarget) {
        runHighlighter(hashTarget);
      }
    });
  } else {
    // 2. Direct fallback to URL text fragment
    const hashTarget = extractTargetFromHash();
    if (hashTarget) {
      runHighlighter(hashTarget);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initAskSakaWidget();
    initSakaQuoteHighlighter();
  });
} else {
  initAskSakaWidget();
  initSakaQuoteHighlighter();
}

// Support in-page hash changes for SPA citation navigation
window.addEventListener('hashchange', () => {
  initSakaQuoteHighlighter();
});
