import React, { useRef, useEffect } from 'react';
import { Bot } from 'lucide-react';
import { ChatMessage, Citation } from '../../types.js';
import { MessageItem } from './MessageItem.js';
import { ChatInput } from './ChatInput.js';

interface ChatViewProps {
  messages: ChatMessage[];
  statusLog: string[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onHoverCitation?: (citation: Citation, targetRect: DOMRect) => void;
  onLeaveCitation?: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  statusLog,
  isStreaming,
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

  return (
    <div className="saka-chat-container">
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
            />
          ))
        )}
      </div>

      <ChatInput onSend={onSendMessage} disabled={isStreaming} />
    </div>
  );
};
