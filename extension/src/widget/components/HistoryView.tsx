import React, { useState, useEffect } from 'react';
import { Clock, Trash2, MessageSquarePlus, AlertCircle, RefreshCw } from 'lucide-react';
import { ConversationSummary } from '../../types.js';
import { getBackendUrl, getClientId } from '../../scripts/syncer.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

interface HistoryViewProps {
  onSelectConversation: (id: string) => void;
  onStartNewChat: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  onSelectConversation,
  onStartNewChat,
}) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = async () => {
    try {
      setLoading(true);
      setError(null);
      const backendUrl = await getBackendUrl();
      const clientId = await getClientId();
      const res = await bgFetch(`${backendUrl}/conversations?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      setConversations(res.data?.conversations || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Unable to connect to backend: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const backendUrl = await getBackendUrl();
      await bgFetch(`${backendUrl}/conversations/${id}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.warn('[HistoryView] Failed to delete conversation:', err);
    }
  };

  const formatRelativeTime = (isoString: string) => {
    const ms = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="saka-view-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 className="saka-view-title">Conversation History</h3>
        {conversations.length > 0 && (
          <button
            type="button"
            className="saka-btn-primary"
            style={{ padding: '4px 10px', fontSize: '11.5px', borderRadius: '6px' }}
            onClick={onStartNewChat}
          >
            + New Chat
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontSize: '13px', padding: '16px 0' }}>
          <RefreshCw size={14} className="spin" style={{ animation: 'spin 1.2s linear infinite' }} />
          <span>Loading past conversations...</span>
        </div>
      ) : error ? (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            color: '#f87171',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <AlertCircle size={16} />
            <span>Unable to Load History</span>
          </div>
          <p style={{ color: '#fca5a5', lineHeight: 1.4 }}>
            We couldn't retrieve your previous conversations at this time.
          </p>
          <details style={{ fontSize: '11px', color: '#94a3b8' }}>
            <summary style={{ cursor: 'pointer' }}>Technical details</summary>
            <div style={{ marginTop: '4px', fontFamily: 'monospace', color: '#cbd5e1', background: 'rgba(0,0,0,0.25)', padding: '4px 8px', borderRadius: '4px', wordBreak: 'break-all' }}>
              {error}
            </div>
          </details>
          <button
            type="button"
            className="saka-btn-secondary"
            style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: '12px', marginTop: '2px' }}
            onClick={fetchConversations}
          >
            Retry Connection
          </button>
        </div>
      ) : conversations.length === 0 ? (
        <div className="saka-empty-state" style={{ padding: '40px 16px', margin: 'auto 0' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.1) 100%)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#34d399',
              boxShadow: '0 8px 20px -4px rgba(16, 185, 129, 0.2)',
            }}
          >
            <MessageSquarePlus size={28} />
          </div>

          <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff', marginTop: '4px' }}>
            No Conversations Yet
          </h4>

          <p style={{ fontSize: '12.5px', color: '#94a3b8', maxWidth: '280px', lineHeight: 1.5 }}>
            Your chats are saved automatically so you can pick up where you left off or review past SOP checklists.
          </p>

          <button
            type="button"
            className="saka-btn-primary"
            style={{ marginTop: '8px', padding: '8px 18px' }}
            onClick={onStartNewChat}
          >
            + Start a New Chat
          </button>
        </div>
      ) : (
        <div className="saka-history-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className="saka-history-card"
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="saka-history-info">
                <span className="saka-history-title">{conv.title}</span>
                <span className="saka-history-time">
                  {conv.messageCount ? `${conv.messageCount} messages • ` : ''}
                  {formatRelativeTime(conv.updatedAt)}
                </span>
              </div>

              <button
                type="button"
                className="saka-btn-icon"
                onClick={(e) => handleDelete(e, conv.id)}
                title="Delete thread"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
