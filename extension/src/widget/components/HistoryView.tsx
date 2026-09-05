import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Trash2, MessageSquarePlus, AlertCircle, RefreshCw, Lock } from 'lucide-react';
import { ConversationSummary } from '../../types.js';
import { getBackendUrl, getClientId } from '../../scripts/syncer.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

interface HistoryViewProps {
  onSelectConversation: (id: string) => void;
  onStartNewChat: () => void;
  hideHeader?: boolean;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  onSelectConversation,
  onStartNewChat,
  hideHeader = false,
}) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<number | null>(null);

  const fetchConversations = async (query = '') => {
    try {
      if (query.trim()) {
        setSearching(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const backendUrl = await getBackendUrl();
      const clientId = await getClientId();

      let url = `${backendUrl}/conversations?clientId=${encodeURIComponent(clientId)}`;
      if (query.trim()) {
        url = `${backendUrl}/conversations/search?clientId=${encodeURIComponent(clientId)}&q=${encodeURIComponent(query.trim())}`;
      }

      const res = await bgFetch<{ conversations: ConversationSummary[] }>(url);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      setConversations(res.data?.conversations || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Unable to load conversations: ${msg}`);
    } finally {
      setLoading(false);
      setSearching(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = window.setTimeout(() => {
      fetchConversations(val);
    }, 250);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    fetchConversations('');
  };

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

  // Group conversations chronologically
  const groupedConversations = useMemo(() => {
    if (searchQuery.trim()) {
      return [{ title: `Search Results (${conversations.length})`, items: conversations }];
    }

    const today: ConversationSummary[] = [];
    const yesterday: ConversationSummary[] = [];
    const pastWeek: ConversationSummary[] = [];
    const older: ConversationSummary[] = [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOfPastWeek = startOfToday - 7 * 86400000;

    for (const conv of conversations) {
      const time = new Date(conv.updatedAt).getTime();
      if (time >= startOfToday) {
        today.push(conv);
      } else if (time >= startOfYesterday) {
        yesterday.push(conv);
      } else if (time >= startOfPastWeek) {
        pastWeek.push(conv);
      } else {
        older.push(conv);
      }
    }

    const groups = [];
    if (today.length > 0) groups.push({ title: 'Today', items: today });
    if (yesterday.length > 0) groups.push({ title: 'Yesterday', items: yesterday });
    if (pastWeek.length > 0) groups.push({ title: 'Previous 7 Days', items: pastWeek });
    if (older.length > 0) groups.push({ title: 'Older', items: older });

    return groups;
  }, [conversations, searchQuery]);

  return (
    <div className="saka-view-container">
      {!hideHeader && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h3 className="saka-view-title">Conversation History</h3>
          <button
            type="button"
            className="saka-btn-primary"
            style={{ padding: '4px 10px', fontSize: '11.5px', borderRadius: '6px' }}
            onClick={onStartNewChat}
          >
            + New Chat
          </button>
        </div>
      )}

      {/* Zero-Credit Instant Search Bar */}
      <div className="saka-history-search-bar">
        <Search size={14} color="#94a3b8" />
        <input
          type="text"
          className="saka-history-search-input"
          placeholder="Search chat history & content..."
          value={searchQuery}
          onChange={handleSearchChange}
        />
        {searching && <RefreshCw size={13} className="spin" style={{ animation: 'spin 1.2s linear infinite', color: '#38bdf8' }} />}
        {searchQuery && !searching && (
          <button
            type="button"
            className="saka-btn-icon"
            onClick={handleClearSearch}
            title="Clear search"
          >
            <X size={13} />
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
            onClick={() => fetchConversations(searchQuery)}
          >
            Retry Connection
          </button>
        </div>
      ) : conversations.length === 0 ? (
        <div className="saka-empty-state" style={{ padding: '36px 16px', margin: 'auto 0' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.1) 100%)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#34d399',
              boxShadow: '0 8px 20px -4px rgba(16, 185, 129, 0.2)',
            }}
          >
            <MessageSquarePlus size={26} />
          </div>

          <h4 style={{ fontSize: '14.5px', fontWeight: 700, color: '#ffffff', marginTop: '4px' }}>
            {searchQuery ? 'No Matches Found' : 'No Conversations Yet'}
          </h4>

          <p style={{ fontSize: '12px', color: '#94a3b8', maxWidth: '280px', lineHeight: 1.5 }}>
            {searchQuery
              ? `No saved conversations match "${searchQuery}". Try a different keyword.`
              : 'Your chats are saved automatically so you can pick up where you left off.'}
          </p>

          {searchQuery ? (
            <button
              type="button"
              className="saka-btn-secondary"
              style={{ marginTop: '6px', padding: '6px 14px' }}
              onClick={handleClearSearch}
            >
              Clear Search Filter
            </button>
          ) : (
            <button
              type="button"
              className="saka-btn-primary"
              style={{ marginTop: '6px', padding: '6px 16px' }}
              onClick={onStartNewChat}
            >
              + Start a New Chat
            </button>
          )}
        </div>
      ) : (
        <div className="saka-history-groups-container">
          {groupedConversations.map((group, gIdx) => (
            <div key={gIdx} className="saka-history-group">
              <div className="saka-history-group-title">{group.title}</div>
              <div className="saka-history-list">
                {group.items.map((conv) => (
                  <div
                    key={conv.id}
                    className="saka-history-card"
                    onClick={() => onSelectConversation(conv.id)}
                  >
                    <div className="saka-history-info">
                      <div className="saka-history-title-row">
                        <span className="saka-history-title" title={conv.title}>
                          {conv.title}
                        </span>
                        {conv.isCompacted && (
                          <span className="saka-badge-compacted" title="Compacted & locked thread">
                            <Lock size={9} style={{ display: 'inline', marginRight: '2px', verticalAlign: 'middle' }} />
                            Compacted
                          </span>
                        )}
                      </div>

                      <span className="saka-history-time">
                        {conv.messageCount ? `${conv.messageCount} msg • ` : ''}
                        {formatRelativeTime(conv.updatedAt)}
                      </span>

                      {conv.snippetMatch && (
                        <div className="saka-history-snippet" title={conv.snippetMatch}>
                          "{conv.snippetMatch}"
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="saka-btn-icon"
                      onClick={(e) => handleDelete(e, conv.id)}
                      title="Delete thread"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
