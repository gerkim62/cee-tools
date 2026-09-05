import React from 'react';
import { BookOpen, ExternalLink, X, Pin, CheckCircle2, FileText } from 'lucide-react';
import { Citation } from '../../types.js';

interface CitationInspectorPaneProps {
  activeCitation: Citation | null;
  previewCitation: Citation | null;
  allAnswerCitations: Citation[];
  isPinned: boolean;
  onSelectCitation: (citation: Citation) => void;
  onClose: () => void;
}

export const CitationInspectorPane: React.FC<CitationInspectorPaneProps> = ({
  activeCitation,
  previewCitation,
  allAnswerCitations,
  isPinned,
  onSelectCitation,
  onClose,
}) => {
  // Display preview citation if hovering, otherwise fall back to pinned active citation
  const displayedCitation = previewCitation || activeCitation;

  const handleOpenSakaHub = (citation: Citation) => {
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
  };

  if (!displayedCitation) {
    return (
      <aside className="saka-workstation-inspector saka-inspector-empty">
        <div className="saka-inspector-header">
          <div className="saka-inspector-title">
            <BookOpen size={15} color="var(--saka-green-primary)" />
            <span>Source Inspector</span>
          </div>
          <button
            type="button"
            className="saka-btn-icon"
            onClick={onClose}
            title="Collapse Inspector"
          >
            <X size={15} />
          </button>
        </div>

        <div className="saka-inspector-empty-body">
          <div className="saka-inspector-empty-icon">
            <FileText size={28} />
          </div>
          <h4>No Citation Selected</h4>
          <p>
            Hover over any citation badge like <span className="saka-citation-tag">[1]</span> in an answer to preview its source, or click to pin it here.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="saka-workstation-inspector">
      {/* Inspector Header */}
      <div className="saka-inspector-header">
        <div className="saka-inspector-title">
          <BookOpen size={15} color="var(--saka-green-primary)" />
          <span>Source Inspector</span>
          {isPinned && !previewCitation ? (
            <span className="saka-inspector-badge-pinned">
              <Pin size={10} />
              <span>Pinned</span>
            </span>
          ) : previewCitation ? (
            <span className="saka-inspector-badge-preview">
              <span>Preview</span>
            </span>
          ) : null}
        </div>

        <button
          type="button"
          className="saka-btn-icon"
          onClick={onClose}
          title="Close Inspector"
        >
          <X size={15} />
        </button>
      </div>

      {/* Citation Tabs for Multi-Source Answers */}
      {allAnswerCitations.length > 1 && (
        <div className="saka-inspector-tabs">
          <span className="saka-inspector-tabs-label">Cited Sources:</span>
          <div className="saka-inspector-tabs-list">
            {allAnswerCitations.map((c, idx) => {
              const citeNum = idx + 1;
              const isSelected =
                displayedCitation.articleId === c.articleId &&
                displayedCitation.quote === c.quote;
              return (
                <button
                  key={`${c.articleId}-${idx}`}
                  type="button"
                  className={`saka-inspector-tab-pill ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelectCitation(c)}
                  title={`${c.articleNumber ? `[${c.articleNumber}] ` : ''}${c.articleTitle}`}
                >
                  <span className="saka-inspector-tab-num">[{citeNum}]</span>
                  <span className="saka-inspector-tab-name">
                    {c.articleNumber || c.articleTitle}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Inspector Body Details */}
      <div className="saka-inspector-body">
        <div className="saka-inspector-article-card">
          <div className="saka-inspector-meta-row">
            {displayedCitation.articleNumber && (
              <span className="saka-popover-num">
                {displayedCitation.articleNumber}
              </span>
            )}
            <span className="saka-inspector-status">
              <CheckCircle2 size={12} color="var(--saka-green-primary)" />
              <span>Verified SakaHub Article</span>
            </span>
          </div>

          <h3 className="saka-inspector-article-title">
            {displayedCitation.articleTitle}
          </h3>

          {displayedCitation.sectionHeading && displayedCitation.sectionHeading !== 'General' && (
            <div className="saka-inspector-section-crumb">
              <span>Section:</span> {displayedCitation.sectionHeading}
            </div>
          )}
        </div>

        {/* Highlighted Quote Excerpt */}
        {displayedCitation.quote && (
          <div className="saka-inspector-quote-box">
            <div className="saka-inspector-quote-label">Verified Procedure / Policy Excerpt:</div>
            <div className="saka-inspector-quote-content">
              &ldquo;{displayedCitation.quote}&rdquo;
            </div>
          </div>
        )}

        {/* Action button to SakaHub portal */}
        <div className="saka-inspector-actions">
          <button
            type="button"
            className="saka-btn-primary saka-inspector-open-btn"
            onClick={() => handleOpenSakaHub(displayedCitation)}
          >
            <span>Open Article in SakaHub</span>
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
};
