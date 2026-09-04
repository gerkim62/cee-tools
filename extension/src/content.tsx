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
 * Handles dynamic SPA routing where native browser #:~:text gets stripped by router before fetch.
 * Uses window.find / Selection API to scroll and highlight the excerpt safely.
 */
function initSakaQuoteHighlighter() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

  chrome.storage.local.get(['pendingSakaHighlight'], (items) => {
    const pending = items.pendingSakaHighlight;
    if (!pending || !pending.quote) return;

    // Only apply if initiated within last 60 seconds
    if (Date.now() - (pending.timestamp || 0) > 60000) {
      chrome.storage.local.remove(['pendingSakaHighlight']).catch(() => {});
      return;
    }

    // Clean excerpt for searching: take first 6-10 significant words
    const cleanWords = pending.quote
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w: string) => w.length > 2);

    if (cleanWords.length === 0) return;
    const searchPhrase = cleanWords.slice(0, 6).join(' ');

    let attempts = 0;
    const maxAttempts = 20;

    const tryHighlight = () => {
      attempts++;
      // Search for text in the page DOM
      // @ts-ignore
      const found = typeof window.find === 'function' ? window.find(searchPhrase, false, false, true, false, false, false) : false;
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
        }

        // Clean up storage once matched
        chrome.storage.local.remove(['pendingSakaHighlight']).catch(() => {});
        return true;
      }

      if (attempts < maxAttempts) {
        setTimeout(tryHighlight, 500);
      }
      return false;
    };

    // Initial attempt + retry loop for dynamic SPA rendering
    setTimeout(tryHighlight, 600);
  });
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
