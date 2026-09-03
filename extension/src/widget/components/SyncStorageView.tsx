import React, { useState, useEffect } from 'react';
import { RefreshCw, Database, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { BackendSyncStatus, SyncProgressUpdate } from '../../types.js';
import { getBackendUrl } from '../../scripts/syncer.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

interface SyncStorageViewProps {
  isSyncing: boolean;
  syncProgress: SyncProgressUpdate | null;
  lastSyncedAt: string | null;
  onTriggerSync: (mode: 'smart' | 'deep') => void;
}

export const SyncStorageView: React.FC<SyncStorageViewProps> = ({
  isSyncing,
  syncProgress,
  lastSyncedAt,
  onTriggerSync,
}) => {
  const [status, setStatus] = useState<BackendSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const backendUrl = await getBackendUrl();
      const res = await bgFetch(`${backendUrl}/sync-status`);
      if (res.ok) {
        setStatus(res.data);
      }
    } catch (err) {
      console.warn('[SyncStorageView] Failed fetching sync status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [isSyncing]);

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return 'Never';
    return new Date(isoString).toLocaleString();
  };

  return (
    <div className="saka-view-container">
      <h3 className="saka-view-title">Sync & Knowledge Base Storage</h3>

      <div className="saka-stats-card">
        <div className="saka-stat-row">
          <span className="saka-stat-label">Total Articles in Database</span>
          <span className="saka-stat-val" style={{ color: '#10b981', fontSize: '15px' }}>
            {status?.totalIndexed ?? (loading ? '...' : 0)}
          </span>
        </div>

        <div className="saka-stat-row">
          <span className="saka-stat-label">Newest Article Date</span>
          <span className="saka-stat-val">
            {formatDate(status?.maxLastUpdated)}
          </span>
        </div>

        <div className="saka-stat-row">
          <span className="saka-stat-label">Active Vector Collection</span>
          <span className="saka-stat-val" style={{ fontFamily: 'monospace', fontSize: '11.5px' }}>
            {status?.activeCollection || 'saka_articles_3072'}
          </span>
        </div>

        <div className="saka-stat-row">
          <span className="saka-stat-label">Last Synchronization</span>
          <span className="saka-stat-val">
            {formatDate(lastSyncedAt)}
          </span>
        </div>
      </div>

      {isSyncing && (
        <div className="saka-stats-card" style={{ border: '1px solid rgba(59, 130, 246, 0.4)' }}>
          <div className="saka-stat-row">
            <span style={{ color: '#93c5fd', fontWeight: 600 }}>Sync in Progress</span>
            <span style={{ color: '#60a5fa' }}>{syncProgress?.progressPercent || 0}%</span>
          </div>
          <p style={{ fontSize: '12px', color: '#cbd5e1' }}>
            {syncProgress?.message || 'Processing articles...'}
          </p>
          <div className="saka-sync-progress-track">
            <div
              className="saka-sync-progress-fill"
              style={{ width: `${Math.max(5, syncProgress?.progressPercent || 0)}%` }}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
        <button
          type="button"
          className="saka-btn-primary"
          onClick={() => onTriggerSync('smart')}
          disabled={isSyncing}
        >
          <RefreshCw size={15} className={isSyncing ? 'spin' : ''} style={isSyncing ? { animation: 'spin 1.5s linear infinite' } : {}} />
          <span>{isSyncing ? 'Synchronizing...' : 'Sync Now (Smart Early-Exit)'}</span>
        </button>

        <button
          type="button"
          className="saka-btn-secondary"
          onClick={() => onTriggerSync('deep')}
          disabled={isSyncing}
          title="Full sweep across all 7 pages to reconcile all IDs and purge deletions"
        >
          <ShieldCheck size={15} />
          <span>Deep Reconciliation Sync</span>
        </button>
      </div>

      <p style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4, marginTop: '4px' }}>
        Smart sync inspects the newest articles and early-exits when reaching already-indexed records, saving 85%+ bandwidth. Deep sync sweeps all 7 pages for complete parity.
      </p>
    </div>
  );
};
