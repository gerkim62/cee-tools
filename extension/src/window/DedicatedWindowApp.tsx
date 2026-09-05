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

export const DedicatedWindowApp: React.FC = () => {
  const chat = useChat();
  const syncState = useSyncState();
  const theme = useTheme();

  const [currentView, setCurrentView] = useState<WidgetView>('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);

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
      const bounds = {
        width: window.outerWidth,
        height: window.outerHeight,
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
      resizeTimer = setTimeout(saveBounds, 400);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('beforeunload', saveBounds);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('beforeunload', saveBounds);
    };
  }, [saveBounds]);

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
              title="Knowledge Base Sync"
            >
              <RefreshCw size={14} />
              <span>Sync</span>
            </button>

            <button
              type="button"
              className={`saka-sidebar-nav-item ${currentView === 'settings' ? 'active' : ''}`}
              onClick={() => setCurrentView('settings')}
              title="Extension Settings"
            >
              <Settings size={14} />
              <span>Preferences</span>
            </button>
          </div>
        </aside>

        {/* Center Main Workspace: Active Chat Stream or Tool View */}
        <section className="saka-workstation-center">
          <div className="saka-workstation-chat-wrapper">
            {currentView === 'chat' && (
              <ChatView
                messages={chat.messages}
                statusLog={chat.statusLog}
                isStreaming={chat.isStreaming}
                isLoadingConversation={chat.isLoadingConversation}
                focusTrigger={chat.focusTrigger}
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
                onClickCitation={handleClickCitation}
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
            onSelectCitation={handleSelectCitationFromTabs}
            onClose={() => setIsInspectorOpen(false)}
          />
        </div>
      </main>
    </div>
  );
};
