import React, { useState, useEffect } from 'react';
import { Check, Wifi, AlertCircle, ChevronDown, ChevronUp, Server, Sliders, Sun, Briefcase, History, Sparkles, RefreshCw } from 'lucide-react';
import { AgentChannel, WidgetView } from '../../types.js';
import { bgFetch } from '../../scripts/bg-fetch.js';
import { useTheme } from '../hooks/useTheme.js';

function isWidgetView(val: string): val is WidgetView {
  return val === 'chat' || val === 'history' || val === 'sync' || val === 'settings';
}

function isAgentChannel(val: string): val is AgentChannel {
  return val === 'care_center' || val === 'retail';
}

export const SettingsView: React.FC = () => {
  const { themePreference, setTheme } = useTheme();
  const [backendUrl, setBackendUrl] = useState('https://cee-tools-wine.vercel.app');
  const [defaultView, setDefaultView] = useState<WidgetView>('chat');
  const [agentChannel, setAgentChannel] = useState<AgentChannel>('care_center');
  const [rememberCrossTab, setRememberCrossTab] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [detectingRole, setDetectingRole] = useState(false);
  const [detectResult, setDetectResult] = useState<{ success: boolean; message: string; needsOpenSaka?: boolean } | null>(null);
  const [detectedDept, setDetectedDept] = useState<string | null>(null);

  useEffect(() => {
    try {
      chrome.storage.local.get(
        [
          'backendUrl',
          'defaultView',
          'saka_agent_channel',
          'saka_remember_conversation_across_tabs',
          'saka_user_department',
        ],
        (res) => {
          if (res.backendUrl) setBackendUrl(res.backendUrl);
          if (res.defaultView) setDefaultView(res.defaultView);
          if (isAgentChannel(res.saka_agent_channel)) setAgentChannel(res.saka_agent_channel);
          if (typeof res.saka_remember_conversation_across_tabs === 'boolean') {
            setRememberCrossTab(res.saka_remember_conversation_across_tabs);
          }
          if (res.saka_user_department) setDetectedDept(String(res.saka_user_department));
        }
      );
    } catch {}
  }, []);

  const handleAutoDetectRole = async () => {
    setDetectingRole(true);
    setDetectResult(null);
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs) {
        throw new Error('Browser tabs API unavailable');
      }
      const tabs = await chrome.tabs.query({ url: 'https://sakahub.safaricom.co.ke/*' });
      const targetTab = tabs.find((t) => typeof t.id === 'number');
      if (!targetTab || typeof targetTab.id !== 'number') {
        setDetectResult({
          success: false,
          needsOpenSaka: true,
          message: 'Please open saka to use this feature.',
        });
        return;
      }

      const response = await chrome.tabs.sendMessage(targetTab.id, {
        type: 'CHECK_SAKAHUB_SESSION',
        force: true,
      });

      if (response && response.authed && isAgentChannel(response.channel)) {
        setAgentChannel(response.channel);
        if (response.department) {
          setDetectedDept(response.department);
        }
        setDetectResult({
          success: true,
          message: `Role: ${response.channel === 'retail' ? 'Retail Shop' : 'Call Center'}${response.department ? ` (${response.department})` : ''}`,
        });
      } else {
        setDetectResult({
          success: false,
          needsOpenSaka: true,
          message: 'Please open saka to use this feature.',
        });
      }
    } catch {
      setDetectResult({
        success: false,
        needsOpenSaka: true,
        message: 'Please open saka to use this feature.',
      });
    } finally {
      setDetectingRole(false);
    }
  };

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
          : 'Service active';
      setTestResult({
        success: true,
        message: `Connected: ${serviceName}`,
      });
    } catch {
      setTestResult({
        success: false,
        message: 'Unable to connect right now. Please check your network connection.',
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
          saka_agent_channel: agentChannel,
          saka_remember_conversation_across_tabs: rememberCrossTab,
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
      <h3 className="saka-view-title">Preferences</h3>

      {/* Role / Channel Selection */}
      <div className="saka-form-group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="saka-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
            <Briefcase size={14} color="#2CB34A" />
            <span>Role / Channel</span>
          </label>

          <button
            type="button"
            onClick={handleAutoDetectRole}
            disabled={detectingRole}
            style={{
              background: 'none',
              border: 'none',
              padding: '2px 6px',
              fontSize: '11px',
              color: '#2CB34A',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              borderRadius: '4px',
              fontWeight: 500,
            }}
            title="Auto-detect role from Saka"
          >
            {detectingRole ? <RefreshCw size={11} className="spin" style={{ animation: 'spin 1.2s linear infinite' }} /> : <Sparkles size={11} />}
            <span>{detectingRole ? 'Detecting...' : 'Auto-detect'}</span>
          </button>
        </div>

        <select
          className="saka-select-input"
          value={agentChannel}
          onChange={(e) => {
            const val = e.target.value;
            if (isAgentChannel(val)) {
              setAgentChannel(val);
            }
          }}
        >
          <option value="care_center">Call Center</option>
          <option value="retail">Retail Shop</option>
        </select>

        <span style={{ fontSize: '11.5px', color: 'var(--saka-ink-secondary, #58655E)' }}>
          Tailors AI guidance for Call Center vs Retail Shop.
        </span>

        {detectResult && (
          <div
            style={{
              marginTop: '4px',
              padding: '5px 8px',
              borderRadius: '5px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '6px',
              background: detectResult.success ? '#E8F5EC' : '#FDF2F2',
              color: detectResult.success ? '#146732' : '#DE1E23',
              border: `1px solid ${detectResult.success ? '#D2E8D8' : '#FCD4D4'}`,
            }}
          >
            {detectResult.success ? <Check size={12} /> : <AlertCircle size={12} />}
            <span>{detectResult.message}</span>
            {detectResult.needsOpenSaka && (
              <a
                href="https://sakahub.safaricom.co.ke"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#2CB34A',
                  fontWeight: 600,
                  textDecoration: 'underline',
                  marginLeft: '2px',
                }}
              >
                [Open Saka]
              </a>
            )}
          </div>
        )}

        {!detectResult && detectedDept && (
          <span style={{ fontSize: '11px', color: 'var(--saka-ink-muted, #85938B)' }}>
            Detected department: {detectedDept}
          </span>
        )}
      </div>

      {/* Keep chat across new tabs */}
      <div className="saka-form-group">
        <label className="saka-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <History size={14} color="#2CB34A" />
          <span>Keep chat across new tabs</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: 'var(--saka-ink-primary)' }}>
          <input
            type="checkbox"
            checked={rememberCrossTab}
            onChange={(e) => setRememberCrossTab(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: '#2CB34A', cursor: 'pointer' }}
          />
          <span>Restore active conversation in new tabs</span>
        </label>
      </div>

      {/* Default screen */}
      <div className="saka-form-group">
        <label className="saka-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sliders size={14} color="#2CB34A" />
          <span>Default screen</span>
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
          <option value="history">History</option>
          <option value="sync">Update AI</option>
        </select>
        <span style={{ fontSize: '11.5px', color: 'var(--saka-ink-secondary, #58655E)' }}>
          Choose what opens when clicking the Ask Saka badge.
        </span>
      </div>

      {/* Theme */}
      <div className="saka-form-group">
        <label className="saka-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sun size={14} color="#2CB34A" />
          <span>Theme</span>
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
          <option value="system">System Default</option>
          <option value="dark">Dark Mode</option>
          <option value="light">Light Mode</option>
        </select>
      </div>

      {/* Collapsible Server Settings */}
      <div className="saka-advanced-box">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="saka-advanced-toggle"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={14} color="var(--saka-ink-secondary, #58655E)" />
            <span>Server Settings</span>
          </div>
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showAdvanced && (
          <div className="saka-advanced-content">
            <div className="saka-form-group" style={{ marginBottom: 0 }}>
              <label className="saka-label" style={{ fontSize: '11px' }}>Server Address</label>
              <input
                type="url"
                className="saka-text-input"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                placeholder="https://cee-tools-wine.vercel.app"
                style={{ fontFamily: 'monospace', fontSize: '11.5px' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--saka-ink-muted, #85938B)' }}>
                AI server URL.
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
              <span>{testing ? 'Checking connection...' : 'Test Connection'}</span>
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
