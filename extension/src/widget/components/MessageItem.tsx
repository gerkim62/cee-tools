import React, { useState, useRef, useMemo, useEffect } from 'react';
import { marked } from 'marked';
import {
  Copy,
  Check,
  Compass,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  RotateCcw,
  Edit3,
  X,
  CornerDownLeft,
} from 'lucide-react';
import { ChatMessage, Citation } from '../../types.js';
import { BranchInfo } from '../hooks/useChat.js';
import { RollingStatus } from './RollingStatus.js';

interface MessageItemProps {
  message: ChatMessage;
  statusLog: string[];
  branchInfo?: BranchInfo;
  onSwitchBranch?: (direction: 'prev' | 'next') => void;
  onRetryResponse?: (messageId: string) => void;
  onEditUserMessage?: (messageId: string, newContent: string) => void;
  onHoverCitation?: (citation: Citation, targetRect: DOMRect) => void;
  onLeaveCitation?: () => void;
  onSendMessage?: (text: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const past = new Date(dateStr).getTime();
  if (isNaN(past)) return '';
  const diffSec = Math.max(0, Math.floor((now - past) / 1000));
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  statusLog,
  branchInfo,
  onSwitchBranch,
  onRetryResponse,
  onEditUserMessage,
  onHoverCitation,
  onLeaveCitation,
  onSendMessage,
}) => {
  const [copied, setCopied] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const [isExecutionExpanded, setIsExecutionExpanded] = useState(Boolean(message.isStreaming));
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const prevStreamingRef = useRef(message.isStreaming);

  useEffect(() => {
    // Auto-focus textarea when entering edit mode
    if (isEditing && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    // When streaming finishes, auto-collapse execution steps unless user manually toggled it
    if (prevStreamingRef.current && !message.isStreaming) {
      if (!userToggled) {
        setIsExecutionExpanded(false);
      }
    }
    prevStreamingRef.current = message.isStreaming;
  }, [message.isStreaming, userToggled]);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleCopy = () => {
    if (!message.content) return;
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    setIsEditing(false);
    if (trimmed !== message.content) {
      onEditUserMessage?.(message.id, trimmed);
    }
  };

  // Convert markdown to HTML and inject interactive citation buttons
  const renderedHtml = useMemo(() => {
    if (!message.content) return '';
    try {
      const parsed = marked.parse(message.content, { async: false });
      let html = typeof parsed === 'string' ? parsed : '';

      // Normalize any [source 8], [Source 8], [src 8] variants
      html = html.replace(/\[\s*(?:source|src)?\s*(\d+(?:\s*,\s*(?:source|src)?\s*\d+)*)\s*\]/gi, '[$1]');

      // Replace single or grouped citations like [1] or [1, 2, 3] with individual interactive button tags
      html = html.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_match, group) => {
        const nums = group.split(',').map((s: string) => s.trim()).filter(Boolean);
        return nums
          .map((numStr: string) => {
            const citeNum = parseInt(numStr, 10);
            const cite = message.citations?.[citeNum - 1];
            const titleText = cite
              ? `Source [${numStr}]: ${cite.articleNumber ? `[${cite.articleNumber}] ` : ''}${cite.articleTitle} (Click to open in SakaHub, hover for excerpt)`
              : `Source [${numStr}] — Click to open in SakaHub`;
            const safeTitle = titleText.replace(/"/g, '&quot;');
            return `<button type="button" class="saka-citation-tag" data-cite-num="${numStr}" title="${safeTitle}">[${numStr}]</button>`;
          })
          .join(' ');
      });
      return html;
    } catch {
      return message.content;
    }
  }, [message.content, message.citations]);

  // Event delegation for citation clicks and hovers
  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target instanceof Element ? e.target.closest('.saka-citation-tag') : null;
    if (!target) return;

    const citeNum = parseInt(target.getAttribute('data-cite-num') || '0', 10);
    const citation = message.citations?.[citeNum - 1];
    if (citation?.urlWithTextFragment) {
      // Store pending quote highlight for SakaHub SPA content script to locate on mount
      if (citation.quote && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          pendingSakaHighlight: {
            articleId: citation.articleId,
            quote: citation.quote,
            timestamp: Date.now(),
          },
        }).catch(() => {});
      }
      window.open(citation.urlWithTextFragment, '_blank', 'noopener,noreferrer');
    }
  };

  const handleContainerMouseOver = (e: React.MouseEvent) => {
    const target = e.target instanceof Element ? e.target.closest('.saka-citation-tag') : null;
    if (!target || !onHoverCitation) return;

    const citeNum = parseInt(target.getAttribute('data-cite-num') || '0', 10);
    const citation = message.citations?.[citeNum - 1];
    if (!citation) return;

    const targetRect = target.getBoundingClientRect();
    onHoverCitation(citation, targetRect);
  };

  const handleContainerMouseOut = (e: React.MouseEvent) => {
    const target = e.target instanceof Element ? e.target.closest('.saka-citation-tag') : null;
    if (!target || !onLeaveCitation) return;
    onLeaveCitation();
  };

  // ----------------------------------------------------
  // USER MESSAGE RENDERING
  // ----------------------------------------------------
  if (message.role === 'user') {
    if (isEditing) {
      return (
        <div className="saka-user-edit-container">
          <textarea
            ref={editTextareaRef}
            className="saka-user-edit-textarea"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSaveEdit();
              } else if (e.key === 'Escape') {
                setIsEditing(false);
              }
            }}
            rows={2}
          />
          <div className="saka-user-edit-actions">
            <button
              type="button"
              className="saka-user-edit-btn saka-user-edit-cancel"
              onClick={() => setIsEditing(false)}
            >
              <X size={12} />
              <span>Cancel</span>
            </button>
            <button
              type="button"
              className="saka-user-edit-btn saka-user-edit-save"
              onClick={handleSaveEdit}
              disabled={!editText.trim()}
            >
              <CornerDownLeft size={12} />
              <span>Save & Submit</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="saka-user-message-wrapper">
        <div className="saka-message-bubble saka-message-user">
          {message.content}
        </div>

        <div className="saka-user-actions">
          {message.createdAt && (
            <span className="saka-message-time">{formatRelativeTime(message.createdAt)}</span>
          )}

          {branchInfo && branchInfo.total > 1 && (
            <div className="saka-branch-nav saka-branch-nav-user">
              <button
                type="button"
                className="saka-branch-btn"
                disabled={!branchInfo.canPrev}
                onClick={() => onSwitchBranch?.('prev')}
                title="Previous question branch"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="saka-branch-counter">
                {branchInfo.current} / {branchInfo.total}
              </span>
              <button
                type="button"
                className="saka-branch-btn"
                disabled={!branchInfo.canNext}
                onClick={() => onSwitchBranch?.('next')}
                title="Next question branch"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}

          <button
            type="button"
            className="saka-action-btn saka-user-edit-trigger"
            onClick={() => {
              setEditText(message.content);
              setIsEditing(true);
            }}
            title="Edit question & branch"
          >
            <Edit3 size={11} />
            <span>Edit</span>
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // ASSISTANT MESSAGE RENDERING
  // ----------------------------------------------------
  const steps = message.executionSteps || [];
  const isErrorOrInterrupted =
    Boolean(message.isError) ||
    Boolean(
      message.content &&
        (message.content.includes('⚠️') || message.content.includes('❌') || message.content.includes('Interrupted'))
    );

  return (
    <div className="saka-assistant-message-wrapper">
      <div
        ref={containerRef}
        className="saka-message-bubble saka-message-assistant"
        onClick={handleContainerClick}
        onMouseOver={handleContainerMouseOver}
        onMouseOut={handleContainerMouseOut}
      >
        <div className="saka-assistant-header">
          <div className="saka-assistant-label">
            <span>Ask Saka</span>
          </div>
        </div>

        {/* Terminal rolling log while thinking before any tokens arrive */}
        {message.isStreaming && !message.content && (
          <RollingStatus statusLog={statusLog} />
        )}

        {/* Persistent Execution Steps Disclosure */}
        {steps.length > 0 && (
          <div className="saka-execution-box">
            <button
              type="button"
              className="saka-execution-toggle"
              onClick={() => {
                setUserToggled(true);
                setIsExecutionExpanded((prev) => !prev);
              }}
              title="Toggle understanding & search details"
            >
              <div className="saka-execution-toggle-left">
                <Compass size={13} className="saka-execution-icon" />
                <span>
                  Query Analysis & Sources ({steps.length} {steps.length === 1 ? 'step' : 'steps'})
                </span>
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

        {/* Prominent Retry row for error or interrupted responses */}
        {isErrorOrInterrupted && !message.isStreaming && (
          <div className="saka-error-recovery-row">
            <button
              type="button"
              className="saka-error-retry-action"
              onClick={() => onRetryResponse?.(message.id)}
            >
              <RotateCcw size={12} />
              <span>Retry Answering</span>
            </button>
          </div>
        )}

        {/* Clarifying Question Options */}
        {!message.isStreaming && message.clarifyingQuestion && message.clarifyingQuestion.options && message.clarifyingQuestion.options.length > 0 && (
          <div className="saka-clarification-container">
            <div className="saka-clarification-title">
              <HelpCircle size={13} />
              <span>{message.clarifyingQuestion.prompt}</span>
            </div>
            <div className="saka-clarification-chips">
              {message.clarifyingQuestion.options.map((opt, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="saka-chip-btn saka-chip-clarify"
                  onClick={() => onSendMessage?.(opt)}
                  title={`Select: ${opt}`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Follow-up Question Chips */}
        {!message.isStreaming && message.suggestedFollowUps && message.suggestedFollowUps.length > 0 && (
          <div className="saka-followups-container">
            <div className="saka-followups-chips">
              {message.suggestedFollowUps.map((suggestion, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="saka-chip-btn saka-chip-followup"
                  onClick={() => onSendMessage?.(suggestion)}
                  title={`Ask: ${suggestion}`}
                >
                  <span>{suggestion}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* External Bottom Actions Toolbar along bottom-right edge */}
      {!message.isStreaming && message.content && (
        <div className="saka-assistant-bottom-actions">
          {message.createdAt && (
            <span className="saka-message-time">{formatRelativeTime(message.createdAt)}</span>
          )}

          {branchInfo && branchInfo.total > 1 && (
            <div className="saka-branch-nav">
              <button
                type="button"
                className="saka-branch-btn"
                disabled={!branchInfo.canPrev}
                onClick={() => onSwitchBranch?.('prev')}
                title="Previous answer branch"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="saka-branch-counter">
                {branchInfo.current} / {branchInfo.total}
              </span>
              <button
                type="button"
                className="saka-branch-btn"
                disabled={!branchInfo.canNext}
                onClick={() => onSwitchBranch?.('next')}
                title="Next answer branch"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}

          <button
            type="button"
            className="saka-action-btn saka-retry-btn"
            onClick={() => onRetryResponse?.(message.id)}
            title="Regenerate answer"
          >
            <RotateCcw size={11} />
            <span>Retry</span>
          </button>

          <button
            type="button"
            className="saka-action-btn saka-copy-btn"
            onClick={handleCopy}
            title="Copy answer to clipboard"
          >
            {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
