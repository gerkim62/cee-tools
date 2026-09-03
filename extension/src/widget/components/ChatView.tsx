import React, { useRef, useEffect, useState } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { ChatMessage, Citation } from '../../types.js';
import { MessageItem } from './MessageItem.js';
import { ChatInput } from './ChatInput.js';
import { CitationHoverCard } from './CitationHoverCard.js';

interface ChatViewProps {
  messages: ChatMessage[];
  statusLog: string[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  statusLog,
  isStreaming,
  onSendMessage,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<any>(null);

  const [hoveredCitation, setHoveredCitation] = useState<{
    citation: Citation;
    position: { top: number; left: number; transform: string };
  } | null>(null);

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

  const handleHoverCitation = (citation: Citation, targetRect: DOMRect) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    if (!containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const spaceAbove = targetRect.top - containerRect.top;

    let top: number;
    let transform: string;

    // If space above is less than 190px, flip to BELOW the citation tag to avoid header collision
    if (spaceAbove < 190) {
      top = targetRect.bottom - containerRect.top + 8;
      transform = 'translateY(0)';
    } else {
      top = targetRect.top - containerRect.top - 8;
      transform = 'translateY(-100%)';
    }

    let left = targetRect.left - containerRect.left - 40;
    if (left < 10) left = 10;
    if (left + 295 > containerRect.width) left = containerRect.width - 305;

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

  return (
    <div className="saka-chat-container" ref={containerRef}>
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
              onHoverCitation={handleHoverCitation}
              onLeaveCitation={handleLeaveCitation}
            />
          ))
        )}
      </div>

      {hoveredCitation && (
        <CitationHoverCard
          citation={hoveredCitation.citation}
          style={{
            top: `${hoveredCitation.position.top}px`,
            left: `${hoveredCitation.position.left}px`,
            transform: hoveredCitation.position.transform,
          }}
          onMouseEnter={handleCardMouseEnter}
          onMouseLeave={handleCardMouseLeave}
        />
      )}

      <ChatInput onSend={onSendMessage} disabled={isStreaming} />
    </div>
  );
};
