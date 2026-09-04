import React, { useState, useRef, useMemo } from 'react';
import { marked } from 'marked';
import { Copy, Check, Sparkles, Compass, ChevronDown, ChevronUp } from 'lucide-react';
import { ChatMessage, Citation } from '../../types.js';
import { RollingStatus } from './RollingStatus.js';

interface MessageItemProps {
  message: ChatMessage;
  statusLog: string[];
  onHoverCitation?: (citation: Citation, targetRect: DOMRect) => void;
  onLeaveCitation?: () => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  statusLog,
  onHoverCitation,
  onLeaveCitation,
}) => {
  const [copied, setCopied] = useState(false);
  const [isExecutionExpanded, setIsExecutionExpanded] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);

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
        const citeNum = parseInt(numStr, 10);
        const cite = message.citations?.[citeNum - 1];
        const titleText = cite
          ? `Source [${numStr}]: ${cite.articleNumber ? `[${cite.articleNumber}] ` : ''}${cite.articleTitle} (Click to open in SakaHub, hover for excerpt)`
          : `Source [${numStr}] — Click to open in SakaHub`;
        const safeTitle = titleText.replace(/"/g, '&quot;');
        return `<button type="button" class="saka-citation-tag" data-cite-num="${numStr}" title="${safeTitle}">[${numStr}]</button>`;
      });
      return html;
    } catch {
      return message.content;
    }
  }, [message.content, message.citations]);

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
    if (!target || !onHoverCitation) return;

    const citeNum = parseInt(target.getAttribute('data-cite-num') || '0', 10);
    const citation = message.citations?.[citeNum - 1];
    if (!citation) return;

    const targetRect = target.getBoundingClientRect();
    onHoverCitation(citation, targetRect);
  };

  const handleContainerMouseOut = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.saka-citation-tag');
    if (!target || !onLeaveCitation) return;
    onLeaveCitation();
  };

  if (message.role === 'user') {
    return (
      <div className="saka-message-bubble saka-message-user">
        {message.content}
      </div>
    );
  }

  const steps = message.executionSteps || [];

  return (
    <div
      ref={containerRef}
      className="saka-message-bubble saka-message-assistant"
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

      {/* Terminal rolling log while thinking before any tokens arrive */}
      {message.isStreaming && !message.content && (
        <RollingStatus statusLog={statusLog} />
      )}

      {/* Persistent Execution Steps Disclosure (Shows how query was interpreted & retrieved) */}
      {steps.length > 0 && (
        <div className="saka-execution-box">
          <button
            type="button"
            className="saka-execution-toggle"
            onClick={() => setIsExecutionExpanded(!isExecutionExpanded)}
            title="Toggle understanding & search details"
          >
            <div className="saka-execution-toggle-left">
              <Compass size={13} className="saka-execution-icon" />
              <span>Query Analysis & Sources ({steps.length} steps)</span>
            </div>
            {isExecutionExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {isExecutionExpanded && (
            <div className="saka-execution-content">
              {steps.map((step, idx) => (
                <div key={idx} className="saka-execution-step">
                  <span className="saka-execution-step-label">{step.label}</span>
                  <span className="saka-execution-step-detail">{step.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {renderedHtml && (
        <div
          className="saka-markdown-body"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      )}
    </div>
  );
};
