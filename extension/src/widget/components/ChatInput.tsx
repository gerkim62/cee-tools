import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Terminal } from 'lucide-react';

interface SlashCommand {
  command: string;
  label: string;
  description: string;
  template: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/sakanumber',
    label: '/sakanumber [number]',
    description: 'Lookup exact article by Saka number (e.g. BPJM-0001)',
    template: 'Saka number: ',
  },
  {
    command: '/reversal',
    label: '/reversal',
    description: 'Check M-PESA & airtime reversal policy, conditions & SLA',
    template: 'What are the reversal procedures, eligibility rules, and SLA?',
  },
  {
    command: '/vet',
    label: '/vet',
    description: 'Customer identification & vetting checklist before action',
    template: 'What is the customer vetting and verification checklist?',
  },
  {
    command: '/escalate',
    label: '/escalate',
    description: 'Escalation matrix, department contacts and SLA turnaround times',
    template: 'What is the escalation matrix, contacts, and SLA for ',
  },
];

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled }) => {
  const [text, setText] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isMenuDismissed, setIsMenuDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSubmittingRef = useRef(false);

  // Determine if slash command menu should be active
  const isSlashActive = text.startsWith('/') && !isMenuDismissed;

  const filteredCommands = useMemo(() => {
    if (!isSlashActive) return [];
    const query = text.toLowerCase().trim();
    return SLASH_COMMANDS.filter(
      (c) => c.command.toLowerCase().startsWith(query) || c.label.toLowerCase().includes(query)
    );
  }, [text, isSlashActive]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  const applyCommand = (cmd: SlashCommand) => {
    setText(cmd.template);
    setIsMenuDismissed(true);
    if (textareaRef.current) {
      textareaRef.current.focus();
      // Position cursor at end
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.value.length;
          textareaRef.current.selectionEnd = textareaRef.current.value.length;
        }
      }, 10);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSlashActive && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyCommand(filteredCommands[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsMenuDismissed(true);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isSubmittingRef.current) return;

    // Lock submission for 500ms to debounce rapid enter/clicks
    isSubmittingRef.current = true;
    setTimeout(() => {
      isSubmittingRef.current = false;
    }, 500);

    onSend(trimmed);
    setText('');
    setIsMenuDismissed(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (!val.startsWith('/')) {
      setIsMenuDismissed(false);
    }

    // Auto-resize
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 100)}px`;
    }
  };

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [disabled]);

  return (
    <footer className="saka-input-bar">
      {/* Floating Slash Command Autocomplete Menu */}
      {isSlashActive && filteredCommands.length > 0 && (
        <div className="saka-slash-menu">
          {filteredCommands.map((cmd, idx) => (
            <button
              key={cmd.command}
              type="button"
              className={`saka-slash-item ${idx === selectedIndex ? 'selected' : ''}`}
              onClick={() => applyCommand(cmd)}
            >
              <div className="saka-slash-header">
                <Terminal size={12} color="#38bdf8" />
                <span className="saka-slash-badge">{cmd.label}</span>
              </div>
              <span className="saka-slash-desc">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      <div className="saka-input-wrapper">
        <textarea
          ref={textareaRef}
          className="saka-textarea"
          rows={1}
          placeholder="Ask a question or type /"
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          type="button"
          className="saka-btn-send"
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          title="Send query (Enter)"
        >
          <Send size={15} />
        </button>
      </div>
    </footer>
  );
};
