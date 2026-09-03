import React from 'react';
import { Bot, Plus, ChevronDown, X } from 'lucide-react';

interface WindowHeaderProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onNewChat: () => void;
  onToggleMenu: () => void;
  onClose: () => void;
  isMenuOpen: boolean;
  currentViewTitle: string;
}

export const WindowHeader: React.FC<WindowHeaderProps> = ({
  onMouseDown,
  onNewChat,
  onToggleMenu,
  onClose,
  isMenuOpen,
  currentViewTitle,
}) => {
  return (
    <header className="saka-header" onMouseDown={onMouseDown}>
      <div className="saka-header-left">
        <div className="saka-brand-logo">
          <Bot size={16} strokeWidth={2.4} />
        </div>
        <div className="saka-title-row">
          <span className="saka-title-text">Ask Saka</span>
          <span className="saka-subtitle-text">{currentViewTitle}</span>
        </div>
      </div>

      <div className="saka-header-actions" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="saka-btn-icon"
          onClick={onNewChat}
          title="Start New Chat"
          aria-label="New Chat"
        >
          <Plus size={17} />
        </button>

        <button
          type="button"
          className={`saka-btn-icon ${isMenuOpen ? 'active' : ''}`}
          onClick={onToggleMenu}
          title="Toggle Navigation Menu"
          aria-label="Menu"
        >
          <ChevronDown
            size={17}
            style={{
              transform: isMenuOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          />
        </button>

        <button
          type="button"
          className="saka-btn-icon"
          onClick={onClose}
          title="Minimize Widget"
          aria-label="Close"
        >
          <X size={17} />
        </button>
      </div>
    </header>
  );
};
