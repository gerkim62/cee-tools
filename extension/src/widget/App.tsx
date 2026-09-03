import React, { useState, useEffect } from 'react';
import { WidgetView, ExtensionMessage } from '../types.js';
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

export const App: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<WidgetView>('chat');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
        if (res.defaultView) {
          setCurrentView(res.defaultView as WidgetView);
        }
      });
    } catch {}
  }, []);

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

  const handleToggleOpen = () => {
    // If the mouse moved significantly, it was a drag, not a click
    if (badgeDraggable.hasMoved()) return;
    setIsOpen((prev) => !prev);
    setIsMenuOpen(false);
  };

  const handleSelectHistoryConversation = (id: string) => {
    chat.loadConversation(id);
    setCurrentView('chat');
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
            onNewChat={chat.startNewChat}
            onToggleMenu={() => setIsMenuOpen((prev) => !prev)}
            onClose={() => setIsOpen(false)}
            isMenuOpen={isMenuOpen}
            currentViewTitle={getViewTitle()}
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

          <SyncBanner
            isSyncing={syncState.isSyncing}
            isStale={syncState.isStale}
            staleReason={syncState.staleReason}
            syncProgress={syncState.syncProgress}
            onSyncNow={() => syncState.triggerSync('smart')}
            onDismissError={syncState.dismissSyncError}
          />

          {currentView === 'chat' && (
            <ChatView
              messages={chat.messages}
              statusLog={chat.statusLog}
              isStreaming={chat.isStreaming}
              onSendMessage={chat.sendMessage}
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
    </div>
  );
};
