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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAskSakaWidget);
} else {
  initAskSakaWidget();
}
