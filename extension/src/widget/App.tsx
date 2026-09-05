import React, { useState, useEffect, useRef } from 'react';
import { X, GripHorizontal } from 'lucide-react';
import { WidgetView, ExtensionMessage, Citation } from '../types.js';
import { useDraggable } from './hooks/useDraggable.js';
import { useSyncState } from './hooks/useSyncState.js';
import { useChat } from './hooks/useChat.js';
import { useTheme } from './hooks/useTheme.js';

import { FloatingBadge } from './components/FloatingBadge.js';
import { WindowHeader } from './components/WindowHeader.js';
import { ChevronMenu } from './components/ChevronMenu.js';
import { SyncBanner } from './components/SyncBanner.js';
import { ChatView } from './components/ChatView.js';
import { HistoryView } from './components/HistoryView.js';
import { SyncStorageView } from './components/SyncStorageView.js';
import { SettingsView } from './components/SettingsView.js';
import { CitationHoverCard } from './components/CitationHoverCard.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ToastProvider, useToast } from './context/ToastContext.js';

const AppInner: React.FC = () => {
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<WidgetView>('chat');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hasDraggedBadge, setHasDraggedBadge] = useState(false);
  const [hasDraggedWindow, setHasDraggedWindow] = useState(false);

  // Citation hovercard state at the root level (allows overflowing outside the widget window)
  const [hoveredCitation, setHoveredCitation] = useState<{
    citation: Citation;
    position: { top: number; left: number; transform: string };
  } | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dragging for collapsed badge
  const badgeDraggable = useDraggable({
    storageKey: 'ask_saka_badge_pos',
    elementWidth: 56,
    elementHeight: 56,
    onDragEnd: () => {
      setHasDraggedBadge(true);
      try {
        chrome.storage.local.set({ saka_has_dragged_badge: true }).catch(() => {});
      } catch {}
    },
  });

  // Dragging for expanded window
  const windowDraggable = useDraggable({
    storageKey: 'ask_saka_window_pos',
    elementWidth: 420,
    elementHeight: 620,
    onDragEnd: () => {
      setHasDraggedWindow(true);
      try {
        chrome.storage.local.set({ saka_has_dragged_window: true }).catch(() => {});
      } catch {}
    },
  });

  // State hooks
  const syncState = useSyncState();
  const chat = useChat();
  const theme = useTheme();

  // Load default view setting & drag hint status on mount
  useEffect(() => {
    try {
      chrome.storage.local.get(
        [
          'defaultView',
          'saka_has_dragged_badge',
          'saka_has_dragged_window',
          'saka_remember_conversation_across_tabs',
          'saka_active_conversation_id',
        ],
        (res) => {
          if (res) {
            const val = res.defaultView;
            if (val === 'chat' || val === 'history' || val === 'sync' || val === 'settings') {
              setCurrentView(val);
            }
            if (typeof res.saka_has_dragged_badge === 'boolean') {
              setHasDraggedBadge(res.saka_has_dragged_badge);
            }
            if (typeof res.saka_has_dragged_window === 'boolean') {
              setHasDraggedWindow(res.saka_has_dragged_window);
            }
            // Restore active conversation across tabs if setting enabled
            if (res.saka_remember_conversation_across_tabs && res.saka_active_conversation_id) {
              chat.loadConversation(res.saka_active_conversation_id);
            }
          }
        }
      );
    } catch {}
  }, []);

  // Dismiss chevron menu on click outside
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const path = e.composedPath ? e.composedPath() : [];
      const inMenu = path.some(
        (el) =>
          el instanceof HTMLElement &&
          (el.classList?.contains('saka-chevron-menu') || el.classList?.contains('saka-header-menu-btn'))
      );
      if (!inMenu) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isMenuOpen]);

  // Check staleness non-blockingly ONLY when user launches/opens the widget
  useEffect(() => {
    if (isOpen) {
      syncState.refreshStatus(false);
    }
  }, [isOpen]);

  // Listen for toolbar toggle & expand messages
  useEffect(() => {
    const handleMessage = (msg: ExtensionMessage | { type: string }) => {
      if (msg.type === 'TOGGLE_WIDGET') {
        setIsOpen((prev) => !prev);
      } else if (msg.type === 'EXPAND_WIDGET') {
        setIsOpen(true);
        if ('conversationId' in msg && typeof msg.conversationId === 'string' && msg.conversationId) {
          if (chat.conversationId !== msg.conversationId) {
            chat.loadConversation(msg.conversationId);
          }
        }
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [chat]);

  // Hierarchical Escape key handler:
  // 1. Dismiss citation preview hovercard if visible
  // 2. Dismiss chevron dropdown menu if open
  // 3. Return to chat view if in a subview (history, sync, settings)
  // 4. Collapse expanded widget window back to floating badge
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hoveredCitation) {
          setHoveredCitation(null);
        } else if (isMenuOpen) {
          setIsMenuOpen(false);
        } else if (currentView !== 'chat') {
          setCurrentView('chat');
        } else if (isOpen) {
          setIsOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hoveredCitation, isMenuOpen, currentView, isOpen]);

  const handleToggleOpen = () => {
    // If the mouse moved significantly, it was a drag, not a click
    if (badgeDraggable.hasMoved()) return;
    setIsOpen((prev) => !prev);
    setIsMenuOpen(false);
  };

  const handleOpenPopout = (mode: 'window' | 'tab') => {
    const type = mode === 'tab' ? 'OPEN_FULL_TAB' : 'OPEN_DEDICATED_WINDOW';
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type,
          conversationId: chat.conversationId || undefined,
        },
        () => {
          setIsOpen(false);
        }
      );
    }
  };

  const handleStartNewChat = () => {
    chat.startNewChat();
    setCurrentView('chat');
    setIsMenuOpen(false);
  };

  const handleCompactConversation = async () => {
    const res = await chat.compactCurrentConversation();
    if (res.success) {
      toast.success('Conversation summarized into new thread');
    } else if (res.error) {
      toast.error(`Compaction failed: ${res.error}`);
    }
  };

  const handleRestoreConversation = async () => {
    const res = await chat.restoreConversation();
    if (res.success) {
      toast.success('Conversation restored');
    } else if (res.error) {
      toast.error(`Restore failed: ${res.error}`);
    }
  };

  const handleSelectHistoryConversation = (id: string) => {
    chat.loadConversation(id);
    setCurrentView('chat');
  };

  const handleHoverCitation = (citation: Citation, targetRect: DOMRect) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    const spaceAbove = targetRect.top;
    let top: number;
    let transform: string;

    // If space above >= 260px, place above; otherwise flip below
    if (spaceAbove >= 260) {
      top = targetRect.top - 6;
      transform = 'translateY(-100%)';
    } else {
      top = targetRect.bottom + 6;
      transform = 'translateY(0)';
    }

    let left = targetRect.left - 60;
    if (left < 12) left = 12;
    if (left + 375 > window.innerWidth) left = window.innerWidth - 380;

    setHoveredCitation({
      citation,
      position: { top, left, transform },
    });
  };

  const handleLeaveCitation = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCitation(null);
    }, 320);
  };

  const handleCardMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
  };

  const handleCardMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCitation(null);
    }, 250);
  };

  const getViewTitle = () => {
    switch (currentView) {
      case 'history':
        return 'History';
      case 'sync':
        return 'Update AI';
      case 'settings':
        return 'Preferences';
      default:
        return 'Assistant';
    }
  };

  const handleDismissBadgeHint = () => {
    setHasDraggedBadge(true);
    try {
      chrome.storage.local.set({ saka_has_dragged_badge: true }).catch(() => {});
    } catch {}
  };

  return (
    <div id="ask-saka-container" data-theme={theme.effectiveTheme} onClick={() => setIsMenuOpen(false)}>
      {/* Collapsed Draggable Floating Badge */}
      {!isOpen && (
        <FloatingBadge
          onToggle={handleToggleOpen}
          isSyncing={syncState.isSyncing}
          isStale={syncState.isStale}
          syncProgress={syncState.syncProgress}
          onMouseDown={badgeDraggable.handleMouseDown}
          showDragHint={!hasDraggedBadge}
          onDismissDragHint={handleDismissBadgeHint}
          style={{
            left: `${badgeDraggable.position.x}px`,
            top: `${badgeDraggable.position.y}px`,
          }}
        />
      )}

      {/* Expanded Draggable Chat & Tools Window */}
      {isOpen && (
        <div
          className="saka-window"
          style={{
            left: `${windowDraggable.position.x}px`,
            top: `${windowDraggable.position.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <WindowHeader
            onMouseDown={windowDraggable.handleMouseDown}
            onNewChat={handleStartNewChat}
            onToggleMenu={() => setIsMenuOpen((prev) => !prev)}
            onClose={() => setIsOpen(false)}
            onOpenPopout={handleOpenPopout}
            isMenuOpen={isMenuOpen}
            currentViewTitle={getViewTitle()}
            lastSyncedAt={syncState.lastSyncedAt}
          />

          {!hasDraggedWindow && (
            <div className="saka-speech-bubble" role="tooltip" aria-label="Drag header hint">
              <div className="saka-speech-bubble-tail-wrapper">
                <svg width="16" height="8" viewBox="0 0 16 8" fill="none">
                  <path
                    d="M1 8 L8 1 L15 8"
                    stroke="rgba(255, 255, 255, 0.22)"
                    strokeWidth="1.2"
                    fill="rgba(22, 28, 24, 0.95)"
                  />
                  <rect x="1" y="7" width="14" height="2" fill="rgba(22, 28, 24, 0.95)" />
                </svg>
              </div>
              <div className="saka-speech-bubble-body">
                <span className="saka-speech-bubble-text">
                  <GripHorizontal size={13} className="saka-bubble-grip-icon" />
                  <span>Drag to reposition</span>
                </span>
                <button
                  type="button"
                  className="saka-bubble-close-btn"
                  onClick={() => {
                    setHasDraggedWindow(true);
                    try {
                      chrome.storage.local.set({ saka_has_dragged_window: true }).catch(() => {});
                    } catch {}
                  }}
                  title="Dismiss hint"
                  aria-label="Dismiss hint"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          )}

          {isMenuOpen && (
            <ChevronMenu
              currentView={currentView}
              onSelectView={(v) => {
                setCurrentView(v);
                setIsMenuOpen(false);
              }}
              onClose={() => setIsMenuOpen(false)}
            />
          )}

          {/* Render SyncBanner ONLY when NOT in the sync view to avoid duplicate loading indicators */}
          {currentView !== 'sync' && (
            <SyncBanner
              isSyncing={syncState.isSyncing}
              isStale={syncState.isStale}
              staleReason={syncState.staleReason}
              syncProgress={syncState.syncProgress}
              onSyncNow={() => syncState.triggerSync('smart')}
              onDismissError={syncState.dismissSyncError}
            />
          )}

          {currentView === 'chat' && (
            <ChatView
              messages={chat.messages}
              statusLog={chat.statusLog}
              isStreaming={chat.isStreaming}
              isStopping={chat.isStopping}
              isLoadingConversation={chat.isLoadingConversation}
              conversationLoadError={chat.conversationLoadError}
              onRetryLoadConversation={() => {
                if (chat.conversationId) {
                  chat.loadConversation(chat.conversationId);
                }
              }}
              onStopStreaming={chat.stopGeneration}
              onResumeGeneration={chat.resumeGeneration}
              isDeleted={chat.isDeleted}
              isRestoring={chat.isRestoring}
              onRestoreConversation={handleRestoreConversation}
              onStartNewChat={handleStartNewChat}
              focusTrigger={chat.focusTrigger}
              conversationTitle={chat.conversationTitle}
              isCompacted={chat.isCompacted}
              isCompacting={chat.isCompacting}
              onCompactConversation={handleCompactConversation}
              onSendMessage={chat.sendMessage}
              getBranchInfo={chat.getBranchInfo}
              onSwitchBranch={chat.switchBranch}
              onRetryResponse={chat.retryResponse}
              onEditUserMessage={chat.editUserMessage}
              onHoverCitation={handleHoverCitation}
              onLeaveCitation={handleLeaveCitation}
            />
          )}

          {currentView === 'history' && (
            <HistoryView
              onSelectConversation={handleSelectHistoryConversation}
              onStartNewChat={handleStartNewChat}
              hideHeader={true}
              activeConversationId={chat.conversationId}
              refreshTrigger={chat.historyRefreshTrigger}
              onDeleteConversation={(id) => {
                chat.markConversationDeleted(id);
              }}
            />
          )}

          {currentView === 'sync' && (
            <SyncStorageView
              isSyncing={syncState.isSyncing}
              syncProgress={syncState.syncProgress}
              lastSyncedAt={syncState.lastSyncedAt}
              onTriggerSync={syncState.triggerSync}
            />
          )}

          {currentView === 'settings' && <SettingsView />}
        </div>
      )}

      {/* Root-level Popover Portal (Outside saka-window so it can freely overflow outside the widget!) */}
      {isOpen && hoveredCitation && (
        <CitationHoverCard
          citation={hoveredCitation.citation}
          style={{
            position: 'fixed',
            top: `${hoveredCitation.position.top}px`,
            left: `${hoveredCitation.position.left}px`,
            transform: hoveredCitation.position.transform,
            zIndex: 2147483647,
          }}
          onMouseEnter={handleCardMouseEnter}
          onMouseLeave={handleCardMouseLeave}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary fallbackTitle="Ask Saka Error">
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </ErrorBoundary>
  );
};
