import React from 'react';
import { MessageSquare, Clock, RefreshCw, Settings } from 'lucide-react';
import { WidgetView } from '../../types.js';

interface ChevronMenuProps {
  currentView: WidgetView;
  onSelectView: (view: WidgetView) => void;
  onClose: () => void;
}

export const ChevronMenu: React.FC<ChevronMenuProps> = ({
  currentView,
  onSelectView,
  onClose,
}) => {
  const menuItems: { view: WidgetView; label: string; icon: React.ReactNode }[] = [
    {
      view: 'chat',
      label: 'Ask Saka Copilot',
      icon: <MessageSquare size={16} />,
    },
    {
      view: 'history',
      label: 'Conversation History',
      icon: <Clock size={16} />,
    },
    {
      view: 'sync',
      label: 'Sync & Storage',
      icon: <RefreshCw size={16} />,
    },
    {
      view: 'settings',
      label: 'Extension Settings',
      icon: <Settings size={16} />,
    },
  ];

  return (
    <div className="saka-chevron-menu" onClick={(e) => e.stopPropagation()}>
      {menuItems.map((item) => (
        <button
          key={item.view}
          type="button"
          className={`saka-menu-item ${currentView === item.view ? 'active' : ''}`}
          onClick={() => {
            onSelectView(item.view);
            onClose();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};
