import React from 'react';
import { Bot, GripHorizontal, X } from 'lucide-react';
import { SyncProgressUpdate } from '../../types.js';

interface FloatingBadgeProps {
  onToggle: () => void;
  isSyncing: boolean;
  isStale: boolean;
  syncProgress: SyncProgressUpdate | null;
  onMouseDown: (e: React.MouseEvent) => void;
  style: React.CSSProperties;
  showDragHint?: boolean;
  onDismissDragHint?: () => void;
}

export const FloatingBadge: React.FC<FloatingBadgeProps> = ({
  onToggle,
  isSyncing,
  isStale,
  syncProgress,
  onMouseDown,
  style,
  showDragHint = false,
  onDismissDragHint,
}) => {
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  const progressPct = syncProgress?.progressPercent ?? 0;
  const strokeDashoffset = circumference - (progressPct / 100) * circumference;

  const statusClass = isSyncing
    ? 'status-syncing'
    : isStale
    ? 'status-stale'
    : 'status-ok';

  const badgeTitle = isSyncing
    ? `Ask Saka (Updating AI ${progressPct}%...)`
    : isStale
    ? 'Ask Saka (SakaHub updates available - click to open)'
    : 'Ask Saka (Ready - click to chat)';

  return (
    <div
      className="saka-floating-badge"
      style={style}
      onMouseDown={onMouseDown}
      onClick={onToggle}
      title={badgeTitle}
      role="button"
      tabIndex={0}
      aria-label="Ask Saka"
    >
      {isSyncing && (
        <svg className="saka-progress-ring" viewBox="0 0 56 56">
          <circle
            className="saka-progress-ring-bg"
            cx="28"
            cy="28"
            r={radius}
          />
          <circle
            className="saka-progress-ring-circle"
            cx="28"
            cy="28"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
      )}

      <div className="saka-badge-icon-wrapper">
        <Bot size={26} strokeWidth={2.2} />
        <div className={`saka-badge-status-dot ${statusClass}`} />
      </div>

      {showDragHint && (
        <div
          className="saka-badge-drag-hint"
          onClick={(e) => {
            e.stopPropagation();
            onDismissDragHint?.();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          role="tooltip"
          aria-label="Drag badge hint"
        >
          <GripHorizontal size={13} className="saka-badge-drag-hint-grip" />
          <span>Drag to reposition</span>
          {onDismissDragHint && (
            <button
              type="button"
              className="saka-badge-drag-hint-close"
              onClick={(e) => {
                e.stopPropagation();
                onDismissDragHint();
              }}
              title="Dismiss hint"
              aria-label="Dismiss hint"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
