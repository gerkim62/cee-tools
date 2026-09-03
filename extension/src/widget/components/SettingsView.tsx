import React, { useState, useEffect } from 'react';
import { Check, Wifi, AlertCircle } from 'lucide-react';
import { WidgetView } from '../../types.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

export const SettingsView: React.FC = () => {
  const [backendUrl, setBackendUrl] = useState('http://localhost:3000');
  const [defaultView, setDefaultView] = useState<WidgetView>('chat');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      chrome.storage.local.get(['backendUrl', 'defaultView'], (res) => {
        if (res.backendUrl) setBackendUrl(res.backendUrl);
        if (res.defaultView) setDefaultView(res.defaultView);
      });
    } catch {}
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const trimmed = backendUrl.trim().replace(/\/+$/, '');
      const res = await bgFetch(`${trimmed}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = res.data;
      setTestResult({
        success: true,
        message: `Connected successfully: ${json?.service || 'Backend online'}`,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Connection failed: ${err.message || 'Server unreachable'}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const trimmed = backendUrl.trim().replace(/\/+$/, '');
    try {
      chrome.storage.local.set(
        {
          backendUrl: trimmed,
          defaultView,
        },
        () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }
      );
    } catch {}
  };

  return (
    <div className="saka-view-container">
      <h3 className="saka-view-title">Extension Settings</h3>

      <div className="saka-form-group">
        <label className="saka-label">Backend Server URL</label>
        <input
          type="url"
          className="saka-text-input"
          value={backendUrl}
          onChange={(e) => setBackendUrl(e.target.value)}
          placeholder="http://localhost:3000"
        />
        <span style={{ fontSize: '11.5px', color: '#64748b' }}>
          Ask Saka local or deployed backend server URL.
        </span>
      </div>

      <div className="saka-form-group">
        <label className="saka-label">Default View on Widget Click</label>
        <select
          className="saka-select-input"
          value={defaultView}
          onChange={(e) => setDefaultView(e.target.value as WidgetView)}
        >
          <option value="chat">Ask Saka Copilot (Chat)</option>
          <option value="history">Conversation History</option>
          <option value="sync">Sync & Storage</option>
        </select>
        <span style={{ fontSize: '11.5px', color: '#64748b' }}>
          Controls which tool opens automatically when you click the floating badge.
        </span>
      </div>

      {testResult && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: testResult.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: testResult.success ? '#34d399' : '#f87171',
            border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          }}
        >
          {testResult.success ? <Check size={14} /> : <AlertCircle size={14} />}
          <span>{testResult.message}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        <button
          type="button"
          className="saka-btn-secondary"
          style={{ flex: 1 }}
          onClick={handleTest}
          disabled={testing}
        >
          <Wifi size={14} />
          <span>{testing ? 'Testing...' : 'Test Connection'}</span>
        </button>

        <button
          type="button"
          className="saka-btn-primary"
          style={{ flex: 1 }}
          onClick={handleSave}
        >
          {saved ? <Check size={14} /> : null}
          <span>{saved ? 'Saved!' : 'Save Settings'}</span>
        </button>
      </div>
    </div>
  );
};
