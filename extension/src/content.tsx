import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './widget/App.js';
import widgetCss from './widget/widget.css?inline';

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
