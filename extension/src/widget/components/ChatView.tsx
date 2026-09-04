import React, { useRef, useEffect } from 'react';
import { Bot, Minimize2, RefreshCw, Lock } from 'lucide-react';
import { ChatMessage, Citation } from '../../types.js';
import { MessageItem } from './MessageItem.js';
import { ChatInput } from './ChatInput.js';

interface ChatViewProps {
  messages: ChatMessage[];
  statusLog: string[];
  isStreaming: boolean;
  conversationTitle?: string | null;
  isCompacted?: boolean;
  isCompacting?: boolean;
  onCompactConversation?: () => void;
  onSendMessage: (text: string) => void;
  onHoverCitation?: (citation: Citation, targetRect: DOMRect) => void;
  onLeaveCitation?: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  statusLog,
  isStreaming,
  conversationTitle,
  isCompacted = false,
  isCompacting = false,
  onCompactConversation,
  onSendMessage,
  onHoverCitation,
  onLeaveCitation,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const suggestionChips = [
    { label: 'M-Pesa reversal', query: 'How do I reverse an M-Pesa transaction?' },
    { label: 'Withdrawal fees', query: 'What are the withdrawal charges for M-Pesa?' },
    { label: 'Agent float limit', query: 'What is the daily agent float limit?' },
    { label: 'Postpaid onboarding', query: 'How to onboard a new Postpaid customer?' },
  ];

  // Auto-scroll on new messages or streaming tokens
  useEffect(() => {
    if (scrollRef.current) {
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

      <div className="saka-messages-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="saka-empty-state">
            <div className="saka-empty-icon">
              <Bot size={28} />
            </div>
            <h3 className="saka-empty-title">Ask Saka Copilot</h3>
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
              onHoverCitation={onHoverCitation}
              onLeaveCitation={onLeaveCitation}
              onSendMessage={onSendMessage}
            />
          ))
        )}
      </div>

      {/* Lock banner if conversation is compacted */}
      {isCompacted ? (
        <div className="saka-compacted-lock-banner">
          <Lock size={13} />
          <span>This conversation has been compacted and locked as read-only.</span>
        </div>
      ) : (
        <ChatInput onSend={onSendMessage} disabled={isStreaming} />
      )}
    </div>
  );
};
