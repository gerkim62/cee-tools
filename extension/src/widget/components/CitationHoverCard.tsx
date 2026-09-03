import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Citation } from '../../types.js';

interface CitationHoverCardProps {
  citation: Citation;
  style: React.CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export const CitationHoverCard: React.FC<CitationHoverCardProps> = ({
  citation,
  style,
  onMouseEnter,
  onMouseLeave,
}) => {
  return (
    <div
      className="saka-popover-card"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="saka-popover-title-row">
        {citation.articleNumber && (
          <span className="saka-popover-num">{citation.articleNumber}</span>
        )}
        <span>{citation.articleTitle}</span>
      </div>

      {citation.sectionHeading && citation.sectionHeading !== 'General' && (
        <div className="saka-popover-section">
          &gt; {citation.sectionHeading}
        </div>
      )}

      {citation.quote && (
        <div className="saka-popover-quote">
          &ldquo;{citation.quote}&rdquo;
        </div>
      )}

      <a
        href={citation.urlWithTextFragment}
        target="_blank"
        rel="noopener noreferrer"
        className="saka-popover-link"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <span>Open in SakaHub</span>
        <ExternalLink size={12} />
      </a>
    </div>
  );
};
