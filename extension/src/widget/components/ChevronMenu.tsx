import React from 'react';
import { MessageSquare, Clock, RefreshCw, Settings, Sun, Moon } from 'lucide-react';
import { WidgetView } from '../../types.js';
import { useTheme } from '../hooks/useTheme.js';

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
  const { isDark, toggleTheme } = useTheme();

  const menuItems: { view: WidgetView; label: string; icon: React.ReactNode }[] = [
    {
      view: 'chat',
      label: 'Ask Saka',
      icon: <MessageSquare size={16} />,
    },
    {
      view: 'history',
      label: 'History',
      icon: <Clock size={16} />,
    },
    {
      view: 'sync',
      label: 'Update AI',
      icon: <RefreshCw size={16} />,
    },
    {
      view: 'settings',
      label: 'Preferences',
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

      <div className="saka-menu-divider" />

      <button
        type="button"
        className="saka-menu-item"
        onClick={() => {
          toggleTheme();
          onClose();
        }}
        title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
        <span>{isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
      </button>
    </div>
  );
};
