import React from 'react';
import ReactDOM from 'react-dom/client';
import { DedicatedWindowApp } from './DedicatedWindowApp.js';
import '../widget/widget.css';
import './window.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <DedicatedWindowApp />
    </React.StrictMode>
  );
}
