import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  Plus,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Sun,
  Moon,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import { useChat } from '../widget/hooks/useChat.js';
import { useSyncState } from '../widget/hooks/useSyncState.js';
import { useTheme } from '../widget/hooks/useTheme.js';
import { ChatView } from '../widget/components/ChatView.js';
import { HistoryView } from '../widget/components/HistoryView.js';
import { SyncStorageView } from '../widget/components/SyncStorageView.js';
import { SettingsView } from '../widget/components/SettingsView.js';
import { CitationInspectorPane } from './components/CitationInspectorPane.js';
import { Citation, WidgetView } from '../types.js';
import { SyncBanner } from '../widget/components/SyncBanner.js';
import { ErrorBoundary } from '../widget/components/ErrorBoundary.js';
import { ToastProvider, useToast } from '../widget/context/ToastContext.js';

const DedicatedWindowAppInner: React.FC = () => {
  const toast = useToast();
  const chat = useChat();
  const syncState = useSyncState();
  const theme = useTheme();

  const [currentView, setCurrentView] = useState<WidgetView>('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 720 : true));
  const [isInspectorOpen, setIsInspectorOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 960 : false));

  // Inspector state
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [previewCitation, setPreviewCitation] = useState<Citation | null>(null);
  const [allAnswerCitations, setAllAnswerCitations] = useState<Citation[]>([]);
  const [isPinned, setIsPinned] = useState(false);

  // Check query params on mount & remember open mode (tab vs window)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const isTab = params.get('mode') === 'tab';
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ saka_last_open_mode: isTab ? 'tab' : 'window' }).catch(() => {});
      }
      const initialConvId = params.get('conversationId');
      if (initialConvId) {
        chat.loadConversation(initialConvId);
      }
    } catch {}
  }, []);

  // Window bounds saving on resize/move/unload
  const saveBounds = useCallback(() => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      // If maximized or filling screen, do not overwrite stored normal bounds
      const isMaximized =
        window.outerWidth >= (window.screen.availWidth - 40) &&
        window.outerHeight >= (window.screen.availHeight - 40);
      if (isMaximized) return;

      const bounds = {
        width: Math.min(Math.max(900, window.outerWidth), 1350),
        height: Math.min(Math.max(650, window.outerHeight), 850),
        left: window.screenX,
        top: window.screenY,
      };
      chrome.storage.local.set({ saka_window_bounds: bounds }).catch(() => {});
    } catch {}
  }, []);

  useEffect(() => {
    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      // Auto-collapse when resized narrow
      if (window.innerWidth < 960 && isInspectorOpen) {
        setIsInspectorOpen(false);
      }
      if (window.innerWidth < 720 && isSidebarOpen) {
        setIsSidebarOpen(false);
      }
      resizeTimer = setTimeout(saveBounds, 400);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('beforeunload', saveBounds);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('beforeunload', saveBounds);
    };
  }, [saveBounds, isInspectorOpen, isSidebarOpen]);

  // Sync active conversation ID back to background so closing window returns to the exact chat
  useEffect(() => {
    if (chat.conversationId && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'UPDATE_ACTIVE_CONVERSATION',
        conversationId: chat.conversationId,
      }).catch(() => {});
    }
  }, [chat.conversationId]);


  // Citation hover & click handlers for the inspector
  const handleHoverCitation = (citation: Citation, _targetRect: DOMRect) => {
    setPreviewCitation(citation);
    // Auto-open inspector if it was closed
    if (!isInspectorOpen) {
      setIsInspectorOpen(true);
    }
  };

  const handleLeaveCitation = () => {
    setPreviewCitation(null);
  };

  const handleClickCitation = (citation: Citation, allCitations: Citation[]) => {
    setActiveCitation(citation);
    setAllAnswerCitations(allCitations);
    setIsPinned(true);
    setIsInspectorOpen(true);
  };

  const handleSelectCitationFromTabs = (citation: Citation) => {
    setActiveCitation(citation);
    setIsPinned(true);
  };

  const handleNewChat = () => {
    chat.startNewChat();
    setCurrentView('chat');
    setActiveCitation(null);
    setPreviewCitation(null);
    setAllAnswerCitations([]);
    setIsPinned(false);
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

  const handleSelectHistoryConversation = (convId: string) => {
    chat.loadConversation(convId);
    setCurrentView('chat');
    setActiveCitation(null);
    setPreviewCitation(null);
    setAllAnswerCitations([]);
    setIsPinned(false);
  };

  return (
    <div className="saka-workstation-container" data-theme={theme.effectiveTheme}>
      {/* Workstation Top Navigation Bar (Linear / Notion Style) */}
      <header className="saka-workstation-header">
        <div className="saka-workstation-header-left">
          {/* Toggle Sidebar Button at Far Left Boundary */}
          <button
            type="button"
            className="saka-btn-icon"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title={isSidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
            aria-label="Toggle Sidebar"
          >
            {isSidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>

          <div className="saka-workstation-brand">
            <div className="saka-brand-logo">
              <Bot size={18} strokeWidth={2.4} />
            </div>
            <div className="saka-workstation-title">
              <span className="saka-workstation-name">Ask Saka</span>
              <span className="saka-workstation-badge">Workstation</span>
            </div>
          </div>
        </div>

        <div className="saka-workstation-header-right">
          {/* Theme Quick Toggle */}
          <button
            type="button"
            className="saka-btn-icon"
            onClick={theme.toggleTheme}
            title={theme.isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle Theme"
          >
            {theme.isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Reveal / Toggle Inspector Button on Far Right */}
          <button
            type="button"
            className={`saka-btn-icon ${isInspectorOpen ? 'active' : ''}`}
            onClick={() => setIsInspectorOpen(!isInspectorOpen)}
            title={isInspectorOpen ? 'Collapse Source Inspector' : 'Reveal Source Inspector'}
            aria-label="Toggle Source Inspector"
          >
            {isInspectorOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
        </div>
      </header>

      {/* 3-Pane Main Workstation Body */}
      <main className="saka-workstation-main">
        {/* Left Sidebar: Navigation & Thread History */}
        <aside className={`saka-workstation-sidebar ${!isSidebarOpen ? 'collapsed' : ''}`}>
          <div className="saka-sidebar-header">
            <button
              type="button"
              className="saka-sidebar-newchat-btn"
              onClick={handleNewChat}
              title="Start a new conversation thread"
            >
              <Plus size={15} />
              <span>New Conversation</span>
            </button>
          </div>

          <div className="saka-sidebar-content">
            <HistoryView
              onSelectConversation={handleSelectHistoryConversation}
              onStartNewChat={handleNewChat}
              hideHeader={true}
              activeConversationId={chat.conversationId}
              refreshTrigger={chat.historyRefreshTrigger}
              onDeleteConversation={(id) => {
                if (id === chat.conversationId) {
                  chat.markConversationDeleted();
                }
              }}
            />
          </div>

          <div className="saka-sidebar-footer">
            <button
              type="button"
              className={`saka-sidebar-nav-item ${currentView === 'chat' ? 'active' : ''}`}
              onClick={() => setCurrentView('chat')}
              title="Chat Stream"
            >
              <MessageSquare size={14} />
              <span>Chat</span>
            </button>

            <button
              type="button"
              className={`saka-sidebar-nav-item ${currentView === 'sync' ? 'active' : ''}`}
              onClick={() => setCurrentView('sync')}
              title="Update AI"
            >
              <RefreshCw size={14} />
              <span>Update AI</span>
            </button>

            <button
              type="button"
              className={`saka-sidebar-nav-item ${currentView === 'settings' ? 'active' : ''}`}
              onClick={() => setCurrentView('settings')}
              title="Preferences"
            >
              <Settings size={14} />
              <span>Preferences</span>
            </button>
          </div>
        </aside>

        {/* Center Main Workspace: Active Chat Stream or Tool View */}
        <section className="saka-workstation-center">
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

          <div className="saka-workstation-chat-wrapper">
            {currentView === 'chat' && (
              <ChatView
                messages={chat.messages}
                statusLog={chat.statusLog}
                isStreaming={chat.isStreaming}
                isLoadingConversation={chat.isLoadingConversation}
                conversationLoadError={chat.conversationLoadError}
                onRetryLoadConversation={() => {
                  if (chat.conversationId) {
                    chat.loadConversation(chat.conversationId);
                  }
                }}
                onStopStreaming={chat.stopGeneration}
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
                onClickCitation={handleClickCitation}
                isDeleted={chat.isDeleted}
                isRestoring={chat.isRestoring}
                onRestoreConversation={handleRestoreConversation}
                onStartNewChat={handleNewChat}
              />
            )}

            {currentView === 'sync' && (
              <div style={{ padding: '20px', maxWidth: '680px', width: '100%', margin: '0 auto' }}>
                <SyncStorageView
                  isSyncing={syncState.isSyncing}
                  syncProgress={syncState.syncProgress}
                  lastSyncedAt={syncState.lastSyncedAt}
                  onTriggerSync={syncState.triggerSync}
                />
              </div>
            )}

            {currentView === 'settings' && (
              <div style={{ padding: '20px', maxWidth: '680px', width: '100%', margin: '0 auto' }}>
                <SettingsView />
              </div>
            )}
          </div>
        </section>

        {/* Right Pane: Citations & Knowledge Source Inspector */}
        <div className={`saka-inspector-container ${!isInspectorOpen ? 'collapsed' : ''}`}>
          <CitationInspectorPane
            activeCitation={activeCitation}
            previewCitation={previewCitation}
            allAnswerCitations={allAnswerCitations}
            isPinned={isPinned}
            isCollapsed={!isInspectorOpen}
            onSelectCitation={handleSelectCitationFromTabs}
            onClose={() => setIsInspectorOpen(false)}
          />
        </div>
      </main>
    </div>
  );
};

export const DedicatedWindowApp: React.FC = () => {
  return (
    <ErrorBoundary fallbackTitle="Ask Saka Workstation Error">
      <ToastProvider>
        <DedicatedWindowAppInner />
      </ToastProvider>
    </ErrorBoundary>
  );
};
