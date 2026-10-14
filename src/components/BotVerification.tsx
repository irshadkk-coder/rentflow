import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

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
          'error-callback'?: (errorCode: string) => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact';
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export const BotVerification: React.FC<BotVerificationProps> = ({
  onVerify,
  onExpireOrReset,
  isVerified,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mockVerified, setMockVerified] = useState(isVerified);

  // Read site key from Vite env
  const siteKey = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY || '';

  useEffect(() => {
    setMockVerified(isVerified);
  }, [isVerified]);

  useEffect(() => {
    // If real Turnstile site key is configured in env, load and render Cloudflare Turnstile
    if (siteKey && containerRef.current) {
      let isMounted = true;

      const initTurnstile = () => {
        if (!isMounted || !containerRef.current || !window.turnstile) return;
        try {
          if (widgetIdRef.current) {
            window.turnstile.remove(widgetIdRef.current);
          }
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            callback: (token: string) => {
              if (isMounted) {
                onVerify(token);
              }
            },
            'expired-callback': () => {
              if (isMounted) {
                onExpireOrReset?.();
              }
            },
            'error-callback': () => {
              if (isMounted) {
                onExpireOrReset?.();
              }
            },
            theme: 'light',
          });
        } catch (err) {
          console.warn('Turnstile render warning:', err);
        }
      };

      if (window.turnstile) {
        initTurnstile();
      } else {
        const scriptId = 'cloudflare-turnstile-script';
        if (!document.getElementById(scriptId)) {
          const script = document.createElement('script');
          script.id = scriptId;
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.async = true;
          script.defer = true;
          script.onload = () => initTurnstile();
          document.head.appendChild(script);
        }
      }

      return () => {
        isMounted = false;
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // ignore cleanup error
          }
        }
      };
    }
  }, [siteKey, onVerify, onExpireOrReset]);

  // Handler for development / fallback simulation
  const handleToggleDevVerify = () => {
    if (mockVerified) {
      setMockVerified(false);
      onExpireOrReset?.();
    } else {
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        setMockVerified(true);
        const devToken = `dev-turnstile-token-${Date.now()}`;
        onVerify(devToken);
      }, 350);
    }
  };

  const handleSimulateInvalidToken = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMockVerified(true);
    onVerify('invalid-captcha-token');
  };

  // If real Turnstile site key is available, render the Turnstile mount container
  if (siteKey) {
    return (
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
        <label className="block text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Security & Anti-Bot Verification</span>
        </label>
        <div ref={containerRef} id="cf-turnstile-widget" className="min-h-[65px] flex items-center" />
      </div>
    );
  }

  // Development / Local Fallback UI (Cloudflare Turnstile style)
  return (
    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Anti-Spam & Bot Protection</span>
        </label>
        <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
          Turnstile Guard
        </span>
      </div>

      <div
        onClick={handleToggleDevVerify}
        role="button"
        tabIndex={0}
        id="turnstile-dev-box"
        className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer select-none ${
          mockVerified
            ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-400/50'
            : 'bg-white border-slate-300 hover:border-slate-400 shadow-2xs'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${
              mockVerified
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'bg-slate-50 border-slate-300'
            }`}
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
            ) : mockVerified ? (
              <CheckCircle2 className="w-4 h-4 text-white" />
            ) : null}
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-900">
              {loading
                ? 'Verifying environment...'
                : mockVerified
                ? 'Human Verification Successful'
                : 'Verify you are human'}
            </p>
            <p className="text-[10px] text-slate-500">
              {mockVerified ? 'Token active for booking' : 'Click to complete security check'}
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
