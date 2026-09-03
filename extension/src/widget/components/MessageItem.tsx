import React, { useState, useRef, useMemo } from 'react';
import { marked } from 'marked';
import { Copy, Check, Sparkles } from 'lucide-react';
import { ChatMessage, Citation } from '../../types.js';
import { CitationHoverCard } from './CitationHoverCard.js';
import { RollingStatus } from './RollingStatus.js';

interface MessageItemProps {
  message: ChatMessage;
  statusLog: string[];
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, statusLog }) => {
  const [copied, setCopied] = useState(false);
  const [activeCitation, setActiveCitation] = useState<{
    citation: Citation;
    position: { top: number; left: number };
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<any>(null);

  const handleCopy = () => {
    if (!message.content) return;
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Convert markdown to HTML and inject citation button tags
  const renderedHtml = useMemo(() => {
    if (!message.content) return '';
    try {
      let html = marked.parse(message.content, { async: false }) as string;
      // Replace [1], [2] with interactive citation buttons
      html = html.replace(/\[(\d+)\]/g, (_match, numStr) => {
        return `<button type="button" class="saka-citation-tag" data-cite-num="${numStr}">[${numStr}]</button>`;
      });
      return html;
    } catch {
      return message.content;
    }
  }, [message.content]);

  // Event delegation for citation clicks and hovers
  const handleContainerClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.saka-citation-tag') as HTMLElement | null;
    if (!target) return;

    const citeNum = parseInt(target.getAttribute('data-cite-num') || '0', 10);
    const citation = message.citations?.[citeNum - 1];
    if (citation?.urlWithTextFragment) {
      window.open(citation.urlWithTextFragment, '_blank', 'noopener,noreferrer');
    }
  };

  const handleContainerMouseOver = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.saka-citation-tag') as HTMLElement | null;
    if (!target || !containerRef.current) return;

    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    const citeNum = parseInt(target.getAttribute('data-cite-num') || '0', 10);
    const citation = message.citations?.[citeNum - 1];
    if (!citation) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    // Position popover right above the citation tag, clamped inside container
    let top = targetRect.top - containerRect.top - 10;
    let left = targetRect.left - containerRect.left - 100;

    if (left < 10) left = 10;
    if (left + 290 > containerRect.width) left = containerRect.width - 300;

    setActiveCitation({
      citation,
      position: { top, left },
    });
  };

  const handleContainerMouseOut = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.saka-citation-tag');
    if (!target) return;

    hoverTimeoutRef.current = setTimeout(() => {
      setActiveCitation(null);
    }, 250);
  };

  const handleCardMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
  };

  const handleCardMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setActiveCitation(null);
    }, 200);
  };

  if (message.role === 'user') {
    return (
      <div className="saka-message-bubble saka-message-user">
        {message.content}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="saka-message-bubble saka-message-assistant"
      style={{ position: 'relative' }}
      onClick={handleContainerClick}
      onMouseOver={handleContainerMouseOver}
      onMouseOut={handleContainerMouseOut}
    >
      <div className="saka-assistant-header">
        <div className="saka-assistant-label">
          <Sparkles size={13} />
          <span>Ask Saka</span>
        </div>

        {message.content && !message.isStreaming && (
          <button
            type="button"
            className="saka-copy-btn"
            onClick={handleCopy}
            title="Copy answer to clipboard"
          >
            {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        )}
      </div>

      {message.isStreaming && !message.content && (
        <RollingStatus statusLog={statusLog} />
      )}

      {renderedHtml && (
        <div
          className="saka-markdown-body"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      )}

      {activeCitation && (
        <CitationHoverCard
          citation={activeCitation.citation}
          style={{
            top: `${activeCitation.position.top}px`,
            left: `${activeCitation.position.left}px`,
            transform: 'translateY(-100%)',
          }}
          onMouseEnter={handleCardMouseEnter}
          onMouseLeave={handleCardMouseLeave}
        />
      )}
    </div>
  );
};
