import { useState, useEffect, useRef, useCallback } from 'react';

interface Position {
  x: number;
  y: number;
}

interface UseDraggableOptions {
  storageKey?: string;
  defaultPosition?: Position;
  elementWidth?: number;
  elementHeight?: number;
}

export function useDraggable({
  storageKey = 'ask_saka_badge_pos',
  defaultPosition,
  elementWidth = 56,
  elementHeight = 56,
}: UseDraggableOptions = {}) {
  const [position, setPosition] = useState<Position>(() => {
    return (
      defaultPosition || {
        x: window.innerWidth - elementWidth - 24,
        y: window.innerHeight - elementHeight - 24,
      }
    );
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: position.x,
    posY: position.y,
  });
  const hasMovedRef = useRef(false);

  // Load saved position from chrome.storage.local
  useEffect(() => {
    try {
      chrome.storage.local.get([storageKey], (res) => {
        if (res && res[storageKey] && typeof res[storageKey].x === 'number') {
          const clampedX = Math.min(Math.max(8, res[storageKey].x), window.innerWidth - elementWidth - 8);
          const clampedY = Math.min(Math.max(8, res[storageKey].y), window.innerHeight - elementHeight - 8);
          setPosition({ x: clampedX, y: clampedY });
        }
      });
    } catch {}
  }, [storageKey, elementWidth, elementHeight]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only drag on primary mouse button
      if (e.button !== 0) return;

      setIsDragging(true);
      hasMovedRef.current = false;
      dragStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        posX: position.x,
        posY: position.y,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - dragStartRef.current.startX;
        const deltaY = moveEvent.clientY - dragStartRef.current.startY;

        if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
          hasMovedRef.current = true;
        }

        const newX = dragStartRef.current.posX + deltaX;
        const newY = dragStartRef.current.posY + deltaY;

        // Clamp inside window boundaries
        const clampedX = Math.min(Math.max(8, newX), window.innerWidth - elementWidth - 8);
        const clampedY = Math.min(Math.max(8, newY), window.innerHeight - elementHeight - 8);

        setPosition({ x: clampedX, y: clampedY });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        // Save position if moved
        if (hasMovedRef.current) {
          setPosition((current) => {
            try {
              chrome.storage.local.set({ [storageKey]: current }).catch(() => {});
            } catch {}
            return current;
          });
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [position, storageKey, elementWidth, elementHeight]
  );

  return {
    position,
    setPosition,
    isDragging,
    hasMoved: () => hasMovedRef.current,
    handleMouseDown,
  };
}
