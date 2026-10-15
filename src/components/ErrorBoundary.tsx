import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public props: Props;
  public state: State;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled component error:', error, errorInfo);
  }

  public handleReset = () => {
    (this as any).setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-slate-800 space-y-3 my-4">
          <div className="flex items-center gap-2.5 text-rose-700 font-bold text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600" />
            <span>{this.props.fallbackTitle || 'Component Error'}</span>
          </div>
          <p className="text-xs text-rose-600">
            {this.props.fallbackMessage ||
              'A component failed to render. The rest of the application remains available.'}
          </p>
          {this.state.error?.message && (
            <p className="text-[11px] font-mono text-slate-600 bg-white/80 p-2 rounded-lg border border-rose-100 max-w-xl break-all">
              {this.state.error.message}
            </p>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
