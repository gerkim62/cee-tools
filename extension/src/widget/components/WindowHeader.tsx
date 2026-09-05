import React, { useState, useEffect } from 'react';
import { Bot, Plus, Minus, MoreVertical, Sun, Moon, ChevronDown, Maximize2, ExternalLink, Check } from 'lucide-react';
import { PopoutMode } from '../../types.js';
import { useTheme } from '../hooks/useTheme.js';

interface WindowHeaderProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onNewChat: () => void;
  onToggleMenu: () => void;
  onClose: () => void;
  onOpenPopout?: (mode: PopoutMode) => void;
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
  onOpenPopout,
  isMenuOpen,
  currentViewTitle,
  lastSyncedAt,
}) => {
  const syncLabel = formatSyncTime(lastSyncedAt);
  const [preferredMode, setPreferredMode] = useState<PopoutMode>('window');
  const [isPopoutMenuOpen, setIsPopoutMenuOpen] = useState(false);
  const popoutContainerRef = React.useRef<HTMLDivElement>(null);
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['preferred_popout_mode'], (res) => {
        if (res.preferred_popout_mode === 'tab' || res.preferred_popout_mode === 'window') {
          setPreferredMode(res.preferred_popout_mode);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!isPopoutMenuOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const path = e.composedPath ? e.composedPath() : [];
      if (
        popoutContainerRef.current &&
        !path.includes(popoutContainerRef.current) &&
        (e.target instanceof Node ? !popoutContainerRef.current.contains(e.target) : true)
      ) {
        setIsPopoutMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPopoutMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPopoutMenuOpen]);

  const handleSelectMode = (mode: PopoutMode) => {
    setPreferredMode(mode);
    setIsPopoutMenuOpen(false);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ preferred_popout_mode: mode }).catch(() => {});
    }
    onOpenPopout?.(mode);
  };

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
              <span className="saka-sync-badge-header">
                {syncLabel}
              </span>
            )}
          </div>
          <span className="saka-subtitle-text">{currentViewTitle}</span>
        </div>
      </div>

      <div className="saka-header-actions" onMouseDown={(e) => e.stopPropagation()}>
        {/* Dedicated Pop-out Split Control with Memory */}
        {onOpenPopout && (
          <div className="saka-popout-split-container" ref={popoutContainerRef}>
            <div className="saka-popout-split-group">
              <button
                type="button"
                className="saka-btn-icon saka-popout-main-btn"
                onClick={() => onOpenPopout(preferredMode)}
                title={
                  preferredMode === 'tab'
                    ? 'Open in Full Browser Tab'
                    : 'Open in Dedicated Desktop Window'
                }
                aria-label="Pop out chat"
              >
                {preferredMode === 'tab' ? <ExternalLink size={14} /> : <Maximize2 size={14} />}
              </button>

              <button
                type="button"
                className={`saka-btn-icon saka-popout-chevron-btn ${isPopoutMenuOpen ? 'active' : ''}`}
                onClick={() => setIsPopoutMenuOpen(!isPopoutMenuOpen)}
                title="Pop-out options (Window or Tab)"
                aria-label="Pop-out options"
              >
                <ChevronDown size={11} />
              </button>
            </div>

            {isPopoutMenuOpen && (
              <div className="saka-popout-menu-dropdown" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={`saka-popout-menu-item ${preferredMode === 'window' ? 'selected' : ''}`}
                  onClick={() => handleSelectMode('window')}
                >
                  <Maximize2 size={13} color="var(--saka-green-deep)" />
                  <div className="saka-popout-item-text">
                    <span className="saka-popout-item-title">Dedicated Window</span>
                    <span className="saka-popout-item-desc">Standalone desktop popup</span>
                  </div>
                  {preferredMode === 'window' && (
                    <Check size={13} color="var(--saka-green-primary)" />
                  )}
                </button>

                <button
                  type="button"
                  className={`saka-popout-menu-item ${preferredMode === 'tab' ? 'selected' : ''}`}
                  onClick={() => handleSelectMode('tab')}
                >
                  <ExternalLink size={13} color="var(--saka-green-deep)" />
                  <div className="saka-popout-item-text">
                    <span className="saka-popout-item-title">Full Browser Tab</span>
                    <span className="saka-popout-item-desc">Widescreen tab in Chrome</span>
                  </div>
                  {preferredMode === 'tab' && (
                    <Check size={13} color="var(--saka-green-primary)" />
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Theme Quick Toggle Button */}
        <button
          type="button"
          className="saka-btn-icon"
          onClick={toggleTheme}
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle Theme"
        >
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>

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
          <MoreVertical size={16} />
        </button>

        <button
          type="button"
          className="saka-btn-icon"
          onClick={onClose}
          title="Minimize Widget (Dock to Floating Badge)"
          aria-label="Minimize"
        >
          <Minus size={16} />
        </button>
      </div>
    </header>
  );
};
