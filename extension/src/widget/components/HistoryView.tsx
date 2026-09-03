import React, { useState, useEffect } from 'react';
import { Clock, Trash2, MessageSquare } from 'lucide-react';
import { ConversationSummary } from '../../types.js';
import { getBackendUrl, getClientId } from '../../scripts/syncer.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

interface HistoryViewProps {
  onSelectConversation: (id: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onSelectConversation }) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = async () => {
    try {
      setLoading(true);
      const backendUrl = await getBackendUrl();
      const clientId = await getClientId();
      const res = await bgFetch(`${backendUrl}/conversations?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConversations(res.data?.conversations || []);
    } catch (err) {
      console.warn('[HistoryView] Failed to load conversations:', err);
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
      <h3 className="saka-view-title">Conversation History</h3>

      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: '13px' }}>Loading past threads...</p>
      ) : conversations.length === 0 ? (
        <div className="saka-empty-state" style={{ padding: '20px 0' }}>
          <Clock size={32} color="#64748b" />
          <p className="saka-empty-desc">No past conversations saved yet.</p>
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
