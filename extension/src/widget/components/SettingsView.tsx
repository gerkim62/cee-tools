import React, { useState, useEffect } from 'react';
import { Check, Wifi, AlertCircle, ChevronDown, ChevronUp, Server, Sliders } from 'lucide-react';
import { WidgetView } from '../../types.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

function isWidgetView(val: string): val is WidgetView {
  return val === 'chat' || val === 'history' || val === 'sync' || val === 'settings';
}

export const SettingsView: React.FC = () => {
  const [backendUrl, setBackendUrl] = useState('http://localhost:3000');
  const [defaultView, setDefaultView] = useState<WidgetView>('chat');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      const serviceName =
        typeof json === 'object' && json !== null && 'service' in json && typeof json.service === 'string'
          ? json.service
          : 'Knowledge service active';
      setTestResult({
        success: true,
        message: `Connected: ${serviceName}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({
        success: false,
        message: `Connection failed: ${msg || 'Service unreachable'}`,
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
      <h3 className="saka-view-title">Extension Preferences</h3>

      {/* CEE Experience Settings */}
      <div className="saka-form-group">
        <label className="saka-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sliders size={14} color="#10b981" />
          <span>Default Screen on Click</span>
        </label>
        <select
          className="saka-select-input"
          value={defaultView}
          onChange={(e) => {
            const val = e.target.value;
            if (isWidgetView(val)) {
              setDefaultView(val);
            }
          }}
        >
          <option value="chat">Ask Saka Copilot (Chat)</option>
          <option value="history">Conversation History</option>
          <option value="sync">Knowledge Base Sync</option>
        </select>
        <span style={{ fontSize: '11.5px', color: '#64748b' }}>
          Choose which screen opens when you click the floating dock badge.
        </span>
      </div>

      {/* Collapsible Technical Details for IT/Admins */}
      <div
        style={{
          marginTop: '6px',
          background: 'rgba(15, 23, 42, 0.5)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          borderRadius: '10px',
          overflow: 'hidden',
        }}
      >
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={14} color="#64748b" />
            <span>Technical Server Settings</span>
          </div>
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showAdvanced && (
          <div style={{ padding: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="saka-form-group" style={{ marginBottom: 0 }}>
              <label className="saka-label" style={{ fontSize: '11px', color: '#94a3b8' }}>Backend Service Endpoint</label>
              <input
                type="url"
                className="saka-text-input"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                placeholder="Service endpoint URL"
                style={{ fontFamily: 'monospace', fontSize: '11.5px' }}
              />
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                Configured endpoint for procedural AI synthesis.
              </span>
            </div>

            <button
              type="button"
              className="saka-btn-secondary"
              style={{ alignSelf: 'flex-start', padding: '5px 12px', fontSize: '11.5px' }}
              onClick={handleTest}
              disabled={testing}
            >
              <Wifi size={13} />
              <span>{testing ? 'Checking connection...' : 'Test Endpoint'}</span>
            </button>

            {testResult && (
              <div
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: testResult.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: testResult.success ? '#34d399' : '#f87171',
                  border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                }}
              >
                {testResult.success ? <Check size={13} /> : <AlertCircle size={13} />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: '14px' }}>
        <button
          type="button"
          className="saka-btn-primary"
          style={{ width: '100%', padding: '10px' }}
          onClick={handleSave}
        >
          {saved ? <Check size={14} /> : null}
          <span>{saved ? 'Preferences Saved!' : 'Save Preferences'}</span>
        </button>
      </div>
    </div>
  );
};
