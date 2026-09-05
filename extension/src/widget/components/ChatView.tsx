import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Bot, Minimize2, RefreshCw, Lock, ChevronDown } from 'lucide-react';
import { ChatMessage, Citation } from '../../types.js';
import { BranchInfo } from '../hooks/useChat.js';
import { MessageItem } from './MessageItem.js';
import { ChatInput } from './ChatInput.js';

interface ChatViewProps {
  messages: ChatMessage[];
  statusLog: string[];
  isStreaming: boolean;
  isLoadingConversation?: boolean;
  focusTrigger?: number;
  conversationTitle?: string | null;
  isCompacted?: boolean;
  isCompacting?: boolean;
  onCompactConversation?: () => void;
  onSendMessage: (text: string) => void;
  getBranchInfo?: (messageId: string) => BranchInfo;
  onSwitchBranch?: (messageId: string, direction: 'prev' | 'next') => void;
  onRetryResponse?: (messageId: string) => void;
  onEditUserMessage?: (messageId: string, newContent: string) => void;
  onHoverCitation?: (citation: Citation, targetRect: DOMRect) => void;
  onLeaveCitation?: () => void;
  onClickCitation?: (citation: Citation, allCitations: Citation[]) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  statusLog,
  isStreaming,
  isLoadingConversation = false,
  focusTrigger,
  conversationTitle,
  isCompacted = false,
  isCompacting = false,
  onCompactConversation,
  onSendMessage,
  getBranchInfo,
  onSwitchBranch,
  onRetryResponse,
  onEditUserMessage,
  onHoverCitation,
  onLeaveCitation,
  onClickCitation,
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
              title="Summarize key points, lock this thread, and start a fresh continued chat"
            >
              {isCompacting ? (
                <>
                  <RefreshCw size={11} className="spin" style={{ animation: 'spin 1.2s linear infinite' }} />
                  <span>Compacting...</span>
                </>
              ) : (
                <>
                  <Minimize2 size={11} />
                  <span>Compact</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      <div className="saka-messages-scroll" ref={scrollRef} onScroll={handleScroll}>
        {isLoadingConversation ? (
          <div className="saka-chat-skeleton-container">
            {/* Turn 1: User skeleton bubble (right-aligned) */}
            <div className="saka-skeleton-turn saka-skeleton-turn-user">
              <div className="saka-skeleton-bubble saka-skeleton-bubble-user" style={{ width: '65%' }} />
            </div>

            {/* Turn 1: Assistant skeleton bubble (left-aligned with bot bulb) */}
            <div className="saka-skeleton-turn saka-skeleton-turn-asst">
              <div className="saka-skeleton-avatar" />
              <div className="saka-skeleton-bubble saka-skeleton-bubble-asst">
                <div className="saka-skeleton-line" style={{ width: '85%' }} />
                <div className="saka-skeleton-line" style={{ width: '92%' }} />
                <div className="saka-skeleton-line" style={{ width: '58%' }} />
              </div>
            </div>

            {/* Turn 2: User skeleton bubble */}
            <div className="saka-skeleton-turn saka-skeleton-turn-user">
              <div className="saka-skeleton-bubble saka-skeleton-bubble-user" style={{ width: '48%' }} />
            </div>

            {/* Turn 2: Assistant skeleton bubble */}
            <div className="saka-skeleton-turn saka-skeleton-turn-asst">
              <div className="saka-skeleton-avatar" />
              <div className="saka-skeleton-bubble saka-skeleton-bubble-asst">
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
              Get immediate, verified procedural checklists from Safaricom SakaHub knowledge base.
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

      {/* Lock banner if conversation is compacted */}
      {isCompacted ? (
        <div className="saka-compacted-lock-banner">
          <Lock size={13} />
          <span>This conversation has been compacted and locked as read-only.</span>
        </div>
      ) : (
        <ChatInput onSend={onSendMessage} disabled={isStreaming} focusTrigger={focusTrigger} />
      )}
    </div>
  );
};
