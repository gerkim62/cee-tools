import React from 'react';

interface RollingStatusProps {
  statusLog: string[];
}

export const RollingStatus: React.FC<RollingStatusProps> = ({ statusLog }) => {
  if (statusLog.length === 0) return null;

  return (
    <div className="saka-rolling-log" aria-live="polite">
      {statusLog.map((line, idx) => (
        <div key={idx} className="saka-rolling-log-line">
          {idx === statusLog.length - 1 && <span className="saka-rolling-dot" />}
          <span>{line}</span>
        </div>
      ))}
    </div>
  );
};
