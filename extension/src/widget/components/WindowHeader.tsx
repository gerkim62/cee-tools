import React from 'react';
import { Bot, Plus, ChevronDown, X } from 'lucide-react';

interface WindowHeaderProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onNewChat: () => void;
  onToggleMenu: () => void;
  onClose: () => void;
  isMenuOpen: boolean;
  currentViewTitle: string;
  lastSyncedAt?: string | null;
}

function formatSyncTime(isoString?: string | null): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Updated today';
    if (diffDays === 1) return 'Updated yesterday';
    if (diffDays < 30) return `Updated ${diffDays}d ago`;
    return `Updated ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  } catch {
    return '';
  }
}

export const WindowHeader: React.FC<WindowHeaderProps> = ({
  onMouseDown,
  onNewChat,
  onToggleMenu,
  onClose,
  isMenuOpen,
  currentViewTitle,
  lastSyncedAt,
}) => {
  const syncLabel = formatSyncTime(lastSyncedAt);

  return (
    <header className="saka-header" onMouseDown={onMouseDown}>
      <div className="saka-header-left">
        <div className="saka-brand-logo">
          <Bot size={16} strokeWidth={2.4} />
        </div>
        <div className="saka-title-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="saka-title-text">Ask Saka</span>
            {syncLabel && (
              <span
                style={{
                  fontSize: '9.5px',
                  color: '#94a3b8',
                  background: 'rgba(255, 255, 255, 0.08)',
                  padding: '1px 5px',
                  borderRadius: '4px',
                  fontWeight: 500,
                  letterSpacing: '0.01em',
                }}
              >
                {syncLabel}
              </span>
            )}
          </div>
          <span className="saka-subtitle-text">{currentViewTitle}</span>
        </div>
      </div>

      <div className="saka-header-actions" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="saka-btn-icon"
          onClick={onNewChat}
          title="Start New Chat (Clear current conversation)"
          aria-label="Start New Chat"
        >
          <Plus size={17} />
        </button>

        <button
          type="button"
          className={`saka-btn-icon ${isMenuOpen ? 'active' : ''}`}
          onClick={onToggleMenu}
          title="Navigation Menu (History, Knowledge Sync, Settings)"
          aria-label="Menu"
        >
          <ChevronDown
            size={17}
            style={{
              transform: isMenuOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          />
        </button>

        <button
          type="button"
          className="saka-btn-icon"
          onClick={onClose}
          title="Minimize Widget (Dock to Floating Badge)"
          aria-label="Close"
        >
          <X size={17} />
        </button>
      </div>
    </header>
  );
};
