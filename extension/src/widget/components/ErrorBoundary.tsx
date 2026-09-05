import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Sparkles } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AskSaka ErrorBoundary] Uncaught runtime error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleTryAgain = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  handleFreshSession = () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(['saka_active_conversation_id']).catch(() => { });
      }
    } catch { }
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || 'An unexpected application error occurred.';

      return (
        <div className="saka-error-boundary-screen" role="alert">
          <div className="saka-error-boundary-card">
            <div className="saka-error-boundary-icon-wrapper">
              <AlertTriangle size={28} className="saka-error-boundary-icon" />
            </div>

            <h3 className="saka-error-boundary-title">
              {this.props.fallbackTitle || 'Something went wrong in Ask Saka'}
            </h3>

            <p className="saka-error-boundary-desc">
              The application encountered an unexpected issue while loading.
            </p>

            <details className="saka-error-boundary-details">
              <summary>View technical details</summary>
              <pre className="saka-error-boundary-stack">
                {errorMsg}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>

            <div className="saka-error-boundary-actions">
              <button
                type="button"
                className="saka-btn-secondary"
                onClick={this.handleTryAgain}
              >
                <RotateCcw size={13} />
                <span>Try Again</span>
              </button>

              <button
                type="button"
                className="saka-btn-primary"
                onClick={this.handleFreshSession}
              >
                <Sparkles size={13} />
                <span>Start New Chat</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
