import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ShieldCheck, CheckCircle2, Loader2, AlertCircle, RotateCw } from 'lucide-react';

interface BotVerificationProps {
  onVerify: (token: string) => void;
  onExpireOrReset?: () => void;
  isVerified: boolean;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        params: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: (errorCode?: string) => void;
          'expired-callback'?: () => void;
          'timeout-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'flexible';
          retry?: 'auto' | 'never';
          'retry-interval'?: number;
          'refresh-expired'?: 'auto' | 'manual' | 'never';
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

type WidgetStatus = 'init' | 'loading' | 'verifying' | 'verified' | 'error' | 'expired';

export const BotVerification: React.FC<BotVerificationProps> = ({
  onVerify,
  onExpireOrReset,
  isVerified,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const watchdogTimerRef = useRef<number | null>(null);

  // Keep callback refs stable so parent re-renders do not tear down and re-create the Turnstile widget
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;

  const onExpireOrResetRef = useRef(onExpireOrReset);
  onExpireOrResetRef.current = onExpireOrReset;

  const [widgetStatus, setWidgetStatus] = useState<WidgetStatus>('init');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState<number>(0);

  // Read public site key from Vite environment
  const siteKey = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY || '';

  const clearWatchdog = useCallback(() => {
    if (watchdogTimerRef.current !== null) {
      window.clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  const renderTurnstileWidget = useCallback(() => {
    if (!isMountedRef.current || !containerRef.current || !window.turnstile || !siteKey) return;

    try {
      // Clean up previous widget in this container if it exists
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignore removal error
        }
        widgetIdRef.current = null;
      }

      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }

      setWidgetStatus('verifying');
      setErrorMessage(null);
      clearWatchdog();

      // Start watchdog timer: if Turnstile is stuck verifying for > 12s, provide explicit retry UI
      watchdogTimerRef.current = window.setTimeout(() => {
        if (isMountedRef.current) {
          setWidgetStatus('error');
          setErrorMessage('Verification is taking longer than expected. Please click Retry below to restart the challenge.');
          onExpireOrResetRef.current?.();
        }
      }, 12000);

      const id = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'light',
        size: 'normal',
        retry: 'auto',
        'retry-interval': 3000,
        'refresh-expired': 'auto',
        callback: (token: string) => {
          if (!isMountedRef.current) return;
          clearWatchdog();
          setWidgetStatus('verified');
          setErrorMessage(null);
          onVerifyRef.current(token);
        },
        'expired-callback': () => {
          if (!isMountedRef.current) return;
          clearWatchdog();
          setWidgetStatus('expired');
          setErrorMessage('Verification expired. Please complete the security check again.');
          onExpireOrResetRef.current?.();
        },
        'error-callback': (errorCode?: string) => {
          if (!isMountedRef.current) return;
          clearWatchdog();
          setWidgetStatus('error');
          const codeDesc = errorCode ? ` (Code: ${errorCode})` : '';
          setErrorMessage(`Security verification could not be completed${codeDesc}. Please click Retry below.`);
          onExpireOrResetRef.current?.();
        },
        'timeout-callback': () => {
          if (!isMountedRef.current) return;
          clearWatchdog();
          setWidgetStatus('error');
          setErrorMessage('Verification challenge timed out. Please click Retry below to continue.');
          onExpireOrResetRef.current?.();
        },
      });

      widgetIdRef.current = id;
    } catch (err) {
      console.warn('Turnstile render warning:', err);
      clearWatchdog();
      if (isMountedRef.current) {
        setWidgetStatus('error');
        setErrorMessage('Failed to initialize verification challenge. Please click Retry below.');
        onExpireOrResetRef.current?.();
      }
    }
  }, [siteKey, clearWatchdog]);

  const handleManualRetry = useCallback(() => {
    onExpireOrResetRef.current?.();
    setWidgetStatus('loading');
    setErrorMessage(null);

    if (window.turnstile && widgetIdRef.current) {
      try {
        clearWatchdog();
        window.turnstile.reset(widgetIdRef.current);
        setWidgetStatus('verifying');

        // Restart watchdog
        watchdogTimerRef.current = window.setTimeout(() => {
          if (isMountedRef.current) {
            setWidgetStatus('error');
            setErrorMessage('Verification is taking longer than expected. Please click Retry below.');
            onExpireOrResetRef.current?.();
          }
        }, 12000);
        return;
      } catch {
        // Fall through to complete re-render
      }
    }

    setRetryCounter(prev => prev + 1);
  }, [clearWatchdog]);

  // Sync external verified state
  useEffect(() => {
    if (isVerified) {
      setWidgetStatus('verified');
      setErrorMessage(null);
      clearWatchdog();
    } else if (widgetStatus === 'verified') {
      setWidgetStatus('init');
    }
  }, [isVerified, clearWatchdog, widgetStatus]);

  // Main lifecycle effect for script loading and widget rendering
  useEffect(() => {
    isMountedRef.current = true;
    if (!siteKey) return;

    setWidgetStatus('loading');

    const handleScriptReady = () => {
      if (isMountedRef.current) {
        renderTurnstileWidget();
      }
    };

    const handleScriptFail = () => {
      if (isMountedRef.current) {
        setWidgetStatus('error');
        setErrorMessage('Could not load anti-bot security script. Please ensure content blockers or ad-blockers are disabled for this site.');
        onExpireOrResetRef.current?.();
      }
    };

    if (window.turnstile) {
      handleScriptReady();
    } else {
      const scriptId = 'cloudflare-turnstile-script';
      let script = document.getElementById(scriptId) as HTMLScriptElement | null;

      if (!script) {
        script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = handleScriptReady;
        script.onerror = handleScriptFail;
        document.head.appendChild(script);
      } else {
        // Script element already in DOM: hook listeners if not yet loaded
        if (window.turnstile) {
          handleScriptReady();
        } else {
          script.addEventListener('load', handleScriptReady);
          script.addEventListener('error', handleScriptFail);
        }
      }
    }

    return () => {
      isMountedRef.current = false;
      clearWatchdog();
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignore cleanup error
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, retryCounter, renderTurnstileWidget, clearWatchdog]);

  // Development Fallback if no VITE_TURNSTILE_SITE_KEY configured
  const [devLoading, setDevLoading] = useState<boolean>(false);
  const handleToggleDevVerify = () => {
    if (isVerified) {
      onExpireOrResetRef.current?.();
    } else {
      setDevLoading(true);
      setTimeout(() => {
        setDevLoading(false);
        const devToken = `dev-turnstile-token-${Date.now()}`;
        onVerifyRef.current(devToken);
      }, 350);
    }
  };

  const handleSimulateInvalidToken = (e: React.MouseEvent) => {
    e.stopPropagation();
    onVerifyRef.current('invalid-captcha-token');
  };

  // If real Turnstile site key is configured (Production & Staging)
  if (siteKey) {
    return (
      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Security & Anti-Bot Verification</span>
          </label>
          <div className="text-[10px] font-semibold">
            {isVerified ? (
              <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                Verified
              </span>
            ) : widgetStatus === 'error' ? (
              <span className="text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-rose-500" />
                Action Required
              </span>
            ) : (
              <span className="text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Loader2 className="w-3 h-3 text-emerald-600 animate-spin" />
                Ready for check
              </span>
            )}
          </div>
        </div>

        {/* Turnstile Mount Container */}
        <div className="min-h-[65px] flex items-center justify-center bg-white rounded-lg border border-slate-200/80 p-2">
          <div ref={containerRef} id="cf-turnstile-widget" className="flex items-center justify-center w-full" />
          {widgetStatus === 'loading' && (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
              <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
              <span>Loading security verification...</span>
            </div>
          )}
        </div>

        {/* Error / Timeout Banner with Retry Control */}
        {(widgetStatus === 'error' || widgetStatus === 'expired' || errorMessage) && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-2 animate-in fade-in">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-[11px] leading-tight">
                  {errorMessage || 'Verification challenge failed. Please retry.'}
                </p>
                <p className="text-[10px] text-rose-600 mt-0.5">
                  Ensure ad-blockers allow challenges.cloudflare.com.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end pt-0.5">
              <button
                type="button"
                onClick={handleManualRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-rose-100 border border-rose-300 text-rose-800 font-bold text-[11px] rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5 text-rose-600" />
                <span>Retry Verification</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Development / Local Fallback UI (Cloudflare Turnstile style simulation)
  return (
    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Anti-Spam & Bot Protection</span>
        </label>
        <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
          Turnstile Guard (Dev Mode)
        </span>
      </div>

      <div
        onClick={handleToggleDevVerify}
        role="button"
        tabIndex={0}
        id="turnstile-dev-box"
        className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer select-none ${
          isVerified
            ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-400/50'
            : 'bg-white border-slate-300 hover:border-slate-400 shadow-2xs'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${
              isVerified
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'bg-slate-50 border-slate-300'
            }`}
          >
            {devLoading ? (
              <Loader2 className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
            ) : isVerified ? (
              <CheckCircle2 className="w-4 h-4 text-white" />
            ) : null}
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-900">
              {devLoading
                ? 'Verifying environment...'
                : isVerified
                ? 'Human Verification Successful'
                : 'Verify you are human'}
            </p>
            <p className="text-[10px] text-slate-500">
              {isVerified ? 'Token active for booking' : 'Click to complete security check'}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end text-right">
          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-600">
            <span>Cloudflare</span>
          </div>
          <span className="text-[9px] text-slate-400">Turnstile</span>
        </div>
      </div>

      {/* Dev helper to test invalid token rejection */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 px-0.5">
        <span>Runs client-side verification challenge</span>
        <button
          type="button"
          onClick={handleSimulateInvalidToken}
          className="text-slate-400 hover:text-amber-600 underline cursor-pointer text-[10px]"
          title="Simulate an invalid bot token for error-handling testing"
        >
          [Test Invalid Bot Token]
        </button>
      </div>
    </div>
  );
};
