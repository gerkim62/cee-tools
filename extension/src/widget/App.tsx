import React, { useState, useEffect, useRef } from 'react';
import { WidgetView, ExtensionMessage, Citation } from '../types.js';
import { useDraggable } from './hooks/useDraggable.js';
import { useSyncState } from './hooks/useSyncState.js';
import { useChat } from './hooks/useChat.js';

import { FloatingBadge } from './components/FloatingBadge.js';
import { WindowHeader } from './components/WindowHeader.js';
import { ChevronMenu } from './components/ChevronMenu.js';
import { SyncBanner } from './components/SyncBanner.js';
import { ChatView } from './components/ChatView.js';
import { HistoryView } from './components/HistoryView.js';
import { SyncStorageView } from './components/SyncStorageView.js';
import { SettingsView } from './components/SettingsView.js';
import { CitationHoverCard } from './components/CitationHoverCard.js';

export const App: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<WidgetView>('chat');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
  });

  // Dragging for expanded window
  const windowDraggable = useDraggable({
    storageKey: 'ask_saka_window_pos',
    elementWidth: 420,
    elementHeight: 620,
  });

  // State hooks
  const syncState = useSyncState();
  const chat = useChat();

  // Load default view setting on mount
  useEffect(() => {
    try {
      chrome.storage.local.get(['defaultView'], (res) => {
        const val = res.defaultView;
        if (val === 'chat' || val === 'history' || val === 'sync' || val === 'settings') {
          setCurrentView(val);
        }
      });
    } catch {}
  }, []);

  // Check staleness non-blockingly ONLY when user launches/opens the widget
  useEffect(() => {
    if (isOpen) {
      syncState.refreshStatus(false);
    }
  }, [isOpen]);

  // Listen for toolbar toggle message
  useEffect(() => {
    const handleMessage = (msg: ExtensionMessage | { type: string }) => {
      if (msg.type === 'TOGGLE_WIDGET') {
        setIsOpen((prev) => !prev);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

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

  const handleStartNewChat = () => {
    chat.startNewChat();
    setCurrentView('chat');
    setIsMenuOpen(false);
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
      top = targetRect.top - 8;
      transform = 'translateY(-100%)';
    } else {
      top = targetRect.bottom + 8;
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
    }, 250);
  };

  const handleCardMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
  };

  const handleCardMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCitation(null);
    }, 200);
  };

  const getViewTitle = () => {
    switch (currentView) {
      case 'history':
        return 'History';
      case 'sync':
        return 'Sync & Storage';
      case 'settings':
        return 'Settings';
      default:
        return 'AI Copilot';
    }
  };

  return (
    <div id="ask-saka-container" onClick={() => setIsMenuOpen(false)}>
      {/* Collapsed Draggable Floating Badge */}
      {!isOpen && (
        <FloatingBadge
          onToggle={handleToggleOpen}
          isSyncing={syncState.isSyncing}
          isStale={syncState.isStale}
          syncProgress={syncState.syncProgress}
          onMouseDown={badgeDraggable.handleMouseDown}
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
            isMenuOpen={isMenuOpen}
            currentViewTitle={getViewTitle()}
            lastSyncedAt={syncState.lastSyncedAt}
          />

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
              conversationTitle={chat.conversationTitle}
              isCompacted={chat.isCompacted}
              isCompacting={chat.isCompacting}
              onCompactConversation={chat.compactCurrentConversation}
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
              onStartNewChat={() => {
                chat.startNewChat();
                setCurrentView('chat');
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
