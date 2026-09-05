import React, { useState, useEffect } from 'react';
import { Check, Wifi, AlertCircle, ChevronDown, ChevronUp, Server, Sliders, Sun } from 'lucide-react';
import { WidgetView } from '../../types.js';
import { bgFetch } from '../../scripts/bg-fetch.js';
import { useTheme } from '../hooks/useTheme.js';

function isWidgetView(val: string): val is WidgetView {
  return val === 'chat' || val === 'history' || val === 'sync' || val === 'settings';
}

export const SettingsView: React.FC = () => {
  const { themePreference, setTheme } = useTheme();
  const [backendUrl, setBackendUrl] = useState('https://cee-tools-wine.vercel.app');
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
          <Sliders size={14} color="#2CB34A" />
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
          <option value="chat">Ask Saka (Chat)</option>
          <option value="history">Conversation History</option>
          <option value="sync">Knowledge Base Sync</option>
        </select>
        <span style={{ fontSize: '11.5px', color: 'var(--saka-ink-secondary, #58655E)' }}>
          Choose which screen opens when you click the floating dock badge.
        </span>
      </div>

      {/* Theme Appearance Selector */}
      <div className="saka-form-group">
        <label className="saka-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sun size={14} color="#2CB34A" />
          <span>Appearance & Theme</span>
        </label>
        <select
          className="saka-select-input"
          value={themePreference}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'system' || val === 'dark' || val === 'light') {
              setTheme(val);
            }
          }}
        >
          <option value="system">System Default (Auto)</option>
          <option value="dark">Dark Mode (Subtle Slate)</option>
          <option value="light">Light Mode</option>
        </select>
        <span style={{ fontSize: '11.5px', color: 'var(--saka-ink-secondary, #58655E)' }}>
          Select your color mode or follow your system setting.
        </span>
      </div>

      {/* Collapsible Technical Details for IT/Admins */}
      <div className="saka-advanced-box">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="saka-advanced-toggle"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={14} color="var(--saka-ink-secondary, #58655E)" />
            <span>Technical Server Settings</span>
          </div>
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showAdvanced && (
          <div className="saka-advanced-content">
            <div className="saka-form-group" style={{ marginBottom: 0 }}>
              <label className="saka-label" style={{ fontSize: '11px' }}>Backend Service Endpoint</label>
              <input
                type="url"
                className="saka-text-input"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                placeholder="Service endpoint URL"
                style={{ fontFamily: 'monospace', fontSize: '11.5px' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--saka-ink-muted, #85938B)' }}>
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
                  background: testResult.success ? '#E8F5EC' : '#FDF2F2',
                  color: testResult.success ? '#146732' : '#DE1E23',
                  border: `1px solid ${testResult.success ? '#D2E8D8' : '#FCD4D4'}`,
                  fontWeight: 500,
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
