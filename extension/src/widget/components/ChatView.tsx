import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Bot, Minimize2, RefreshCw, Lock, ChevronDown, RotateCcw, AlertCircle, Plus } from 'lucide-react';
import { ChatMessage, Citation } from '../../types.js';
import { BranchInfo } from '../hooks/useChat.js';
import { MessageItem } from './MessageItem.js';
import { ChatInput } from './ChatInput.js';

interface ChatViewProps {
  messages: ChatMessage[];
  statusLog: string[];
  isStreaming: boolean;
  isLoadingConversation?: boolean;
  conversationLoadError?: string | null;
  onRetryLoadConversation?: () => void;
  onStopStreaming?: () => void;
  focusTrigger?: number;
  conversationTitle?: string | null;
  isCompacted?: boolean;
  isCompacting?: boolean;
  onCompactConversation?: () => void;
  onSendMessage: (text: string) => void;
  getBranchInfo?: (messageId: string) => BranchInfo;
  onSwitchBranch?: (messageId: string, direction: 'prev' | 'next') => void;
  onRetryResponse?: (messageId: string) => void;
  onResumeGeneration?: (messageId: string) => void;
  onEditUserMessage?: (messageId: string, newContent: string) => void;
  onHoverCitation?: (citation: Citation, targetRect: DOMRect) => void;
  onLeaveCitation?: () => void;
  onClickCitation?: (citation: Citation, allCitations: Citation[]) => void;
  isDeleted?: boolean;
  isRestoring?: boolean;
  isStopping?: boolean;
  onRestoreConversation?: () => void;
  onStartNewChat?: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  statusLog,
  isStreaming,
  isStopping = false,
  isLoadingConversation = false,
  conversationLoadError,
  onRetryLoadConversation,
  onStopStreaming,
  focusTrigger,
  conversationTitle,
  isCompacted = false,
  isCompacting = false,
  onCompactConversation,
  onSendMessage,
  getBranchInfo,
  onSwitchBranch,
  onRetryResponse,
  onResumeGeneration,
  onEditUserMessage,
  onHoverCitation,
  onLeaveCitation,
  onClickCitation,
  isDeleted = false,
  isRestoring = false,
  onRestoreConversation,
  onStartNewChat,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const prevMessagesCountRef = useRef(messages.length);

  const suggestionChips = [
    { label: 'M-Pesa reversal', query: 'How do I reverse an M-Pesa transaction?' },
    { label: 'Withdrawal fees', query: 'What are the withdrawal charges for M-Pesa?' },
    { label: 'Agent float limit', query: 'What is the daily agent float limit?' },
    { label: 'Postpaid onboarding', query: 'How to onboard a new Postpaid customer?' },
  ];

  // Check if user is near bottom (within 70px)
  const checkIfNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= 70;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = checkIfNearBottom();
    isUserScrolledUpRef.current = !nearBottom;
    setShowScrollBottomBtn(!nearBottom && messages.length > 0);
  }, [checkIfNearBottom, messages.length]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    isUserScrolledUpRef.current = false;
    setShowScrollBottomBtn(false);
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // When a new message is appended (e.g. user sends message or new response created), scroll to bottom
  useEffect(() => {
    if (messages.length > prevMessagesCountRef.current) {
      isUserScrolledUpRef.current = false;
      scrollToBottom(false);
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages.length, scrollToBottom]);

  // When streaming tokens or status updates arrive: only auto-scroll if user has NOT scrolled up
  useEffect(() => {
    if (!isUserScrolledUpRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, statusLog]);

  const showHeader = Boolean(conversationTitle || (messages.length >= 4 && !isCompacted));

  return (
    <div className="saka-chat-container">
      {/* Optional Top Conversation Header Bar with Compaction Trigger */}
      {showHeader && (
        <div className="saka-chat-header-bar">
          <span className="saka-chat-title-text" title={conversationTitle || 'Active Chat'}>
            {conversationTitle || 'Active Conversation'}
          </span>

          {messages.length >= 4 && !isCompacted && onCompactConversation && (
            <button
              type="button"
              className="saka-compact-btn"
              onClick={onCompactConversation}
              disabled={isCompacting || isStreaming}
              title="Summarize key points and start a fresh continued chat"
            >
              {isCompacting ? (
                <>
                  <RefreshCw size={11} className="spin" style={{ animation: 'spin 1.2s linear infinite' }} />
                  <span>Summarizing...</span>
                </>
              ) : (
                <>
                  <Minimize2 size={11} />
                  <span>Summarize</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Messages Scroll Container */}
      <div className="saka-messages-scroll" ref={scrollRef} onScroll={handleScroll}>
        {conversationLoadError ? (
          <div className="saka-chat-recovery-container">
            <div className="saka-alert-card saka-alert-error" style={{ margin: 'auto 0', maxWidth: '380px' }}>
              <div className="saka-alert-header">
                <AlertCircle size={16} />
                <span>Unable to Load Conversation</span>
              </div>
              <p className="saka-alert-desc">
                We could not retrieve this conversation from the knowledge service.
              </p>
              <details className="saka-alert-details">
                <summary style={{ cursor: 'pointer' }}>Technical details</summary>
                <div className="saka-alert-code">{conversationLoadError}</div>
              </details>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                {onRetryLoadConversation && (
                  <button
                    type="button"
                    className="saka-btn-secondary"
                    style={{ padding: '5px 12px', fontSize: '12px' }}
                    onClick={onRetryLoadConversation}
                  >
                    <RotateCcw size={12} />
                    <span>Retry Loading</span>
                  </button>
                )}
                {onStartNewChat && (
                  <button
                    type="button"
                    className="saka-btn-primary"
                    style={{ padding: '5px 14px', fontSize: '12px' }}
                    onClick={onStartNewChat}
                  >
                    <Plus size={12} />
                    <span>New Chat</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : isLoadingConversation ? (
          <div className="saka-skeleton-container" aria-label="Loading conversation history">
            <div className="saka-skeleton-bubble assistant">
              <div className="saka-skeleton-header">
                <div className="saka-skeleton-avatar" />
                <div className="saka-skeleton-line" style={{ width: '80px', height: '12px' }} />
              </div>
              <div className="saka-skeleton-content">
                <div className="saka-skeleton-line" style={{ width: '92%' }} />
                <div className="saka-skeleton-line" style={{ width: '78%' }} />
                <div className="saka-skeleton-line" style={{ width: '60%' }} />
              </div>
            </div>
            <div className="saka-skeleton-bubble user">
              <div className="saka-skeleton-line" style={{ width: '120px', height: '14px' }} />
            </div>
            <div className="saka-skeleton-bubble assistant">
              <div className="saka-skeleton-header">
                <div className="saka-skeleton-avatar" />
                <div className="saka-skeleton-line" style={{ width: '80px', height: '12px' }} />
              </div>
              <div className="saka-skeleton-content">
                <div className="saka-skeleton-line" style={{ width: '88%' }} />
                <div className="saka-skeleton-line" style={{ width: '70%' }} />
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="saka-empty-state">
            <div className="saka-empty-icon">
              <Bot size={28} />
            </div>
            <h3 className="saka-empty-title">Ask Saka</h3>
            <p className="saka-empty-desc">
              Get immediate, verified answers, guidelines, and troubleshooting steps from Safaricom SakaHub.
            </p>

            <div className="saka-chips-grid">
              {suggestionChips.map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="saka-chip-btn"
                  onClick={() => onSendMessage(chip.query)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageItem
              key={msg.id}
              message={msg}
              statusLog={msg.isStreaming ? statusLog : []}
              branchInfo={getBranchInfo?.(msg.id)}
              isStreaming={isStreaming}
              isStopping={isStopping}
              onResumeGeneration={onResumeGeneration}
              onSwitchBranch={(direction) => onSwitchBranch?.(msg.id, direction)}
              onRetryResponse={onRetryResponse}
              onEditUserMessage={onEditUserMessage}
              onHoverCitation={onHoverCitation}
              onLeaveCitation={onLeaveCitation}
              onClickCitation={onClickCitation}
              onSendMessage={onSendMessage}
            />
          ))
        )}
      </div>

      {/* Floating jump-to-bottom button if user has scrolled up */}
      {showScrollBottomBtn && (
        <button
          type="button"
          className="saka-scroll-bottom-btn"
          onClick={() => scrollToBottom(true)}
          title="Jump to latest response"
        >
          <ChevronDown size={14} />
          {isStreaming && <span className="saka-scroll-streaming-dot" />}
        </button>
      )}

      {/* Deleted or Compacted banner vs ChatInput */}
      {isDeleted ? (
        <div className="saka-deleted-pill-wrapper">
          <div className="saka-deleted-pill-banner">
            <div className="saka-deleted-pill-left">
              <AlertCircle size={14} className="saka-deleted-pill-icon" />
              <span>This conversation has been deleted.</span>
            </div>
            <div className="saka-deleted-pill-actions">
              {onRestoreConversation && (
                <button
                  type="button"
                  className="saka-btn-restore-pill"
                  onClick={onRestoreConversation}
                  disabled={isRestoring}
                  title="Restore this conversation"
                >
                  <RotateCcw size={12} className={isRestoring ? 'saka-spin' : ''} />
                  <span>{isRestoring ? 'Restoring...' : 'Restore'}</span>
                </button>
              )}
              {onStartNewChat && (
                <button
                  type="button"
                  className="saka-btn-newchat-pill"
                  onClick={onStartNewChat}
                  title="Start a fresh conversation"
                >
                  <Plus size={12} />
                  <span>New Chat</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : isCompacted ? (
        <div className="saka-compacted-lock-banner">
          <Lock size={13} />
          <span>This conversation was summarized and closed.</span>
        </div>
      ) : (
        <ChatInput
          onSend={onSendMessage}
          disabled={isStreaming || isStopping}
          focusTrigger={focusTrigger}
          isStreaming={isStreaming}
          isStopping={isStopping}
          onStop={onStopStreaming}
        />
      )}
    </div>
  );
};
