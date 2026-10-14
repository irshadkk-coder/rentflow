import React, { useState, useRef, useEffect } from 'react';
import { ShieldCheck, Mail, ArrowRight, Loader2, AlertCircle, CheckCircle2, RotateCw, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';

interface VerifyPasswordResetOTPViewProps {
  email: string;
  onVerified: (email: string, resetToken: string) => void;
  onBackToForgotPassword: () => void;
  onNavigateLogin?: () => void;
}

export const VerifyPasswordResetOTPView: React.FC<VerifyPasswordResetOTPViewProps> = ({
  email,
  onVerified,
  onBackToForgotPassword,
  onNavigateLogin
}) => {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendFeedback, setResendFeedback] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(60);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  // Focus first input box on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleDigitChange = (index: number, value: string) => {
    // Only accept numeric characters
    const clean = value.replace(/\D/g, '');
    if (!clean && value !== '') return;

    const newDigits = [...digits];
    newDigits[index] = clean ? clean.slice(-1) : '';
    setDigits(newDigits);
    setError(null);

    // Auto-advance to next input
    if (clean && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim();
    const numericOnly = pastedData.replace(/\D/g, '');

    if (!numericOnly) return;

    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = numericOnly[i] || '';
    }
    setDigits(newDigits);
    setError(null);

    // Focus last filled box or 6th box
    const focusIndex = Math.min(numericOnly.length, 5);
    inputRefs.current[focusIndex]?.focus();
  };

  const otpCode = digits.join('');
  const isComplete = otpCode.length === 6 && digits.every((d) => d !== '');

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isComplete) {
      setError('Please enter all 6 digits of your verification code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.verifyPasswordResetOtp({
        email: email.trim(),
        otp: otpCode
      });
      onVerified(email.trim(), res.resetToken);
    } catch (err: any) {
      setError(err.message || 'Invalid verification code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldownSeconds > 0 || resending) return;

    setResending(true);
    setError(null);
    setResendFeedback(null);

    try {
      const res = await api.forgotPassword(email.trim());
      setResendFeedback(res.message || 'A new verification code has been sent.');
      setCooldownSeconds(res.cooldownSeconds || 60);
      setDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification code. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden select-none">
      {/* Decorative background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-xl shadow-emerald-900/40 mb-4">
          <ShieldCheck className="w-7 h-7" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
          Verify Reset Code
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Enter the 6-digit code sent to
        </p>
        <p className="text-sm font-semibold text-emerald-400 mt-0.5 break-all px-4">
          {email}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-8">
          {error && (
            <div
              id="verify-reset-otp-error-alert"
              role="alert"
              className="mb-5 p-3.5 rounded-xl text-xs bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-start gap-2.5 animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
              <div className="flex-1 font-medium leading-relaxed">{error}</div>
            </div>
          )}

          {resendFeedback && (
            <div
              id="verify-reset-otp-feedback"
              className="mb-5 p-3 rounded-xl text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-2 animate-in fade-in"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{resendFeedback}</span>
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-6">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-3 text-center">
                6-Digit Verification Code
              </label>

              {/* 6 Digit Input Group */}
              <div className="flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
                {digits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    id={`verify-reset-otp-digit-${index}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    disabled={loading}
                    aria-label={`Digit ${index + 1}`}
                    aria-invalid={error ? 'true' : 'false'}
                    aria-describedby={error ? 'verify-reset-otp-error-alert' : undefined}
                    className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold font-mono rounded-xl bg-slate-950 border transition-all text-slate-100 focus:outline-none ${
                      digit
                        ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                        : error
                        ? 'border-rose-500/60'
                        : 'border-slate-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
                    }`}
                  />
                ))}
              </div>
              <p className="text-[11px] text-slate-500 text-center mt-2.5">
                Paste or type the 6-digit code. Valid for 10 minutes.
              </p>
            </div>

            <button
              id="verify-reset-otp-submit-btn"
              type="submit"
              disabled={loading || !isComplete}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Code...</span>
                </>
              ) : (
                <>
                  <span>Verify Code</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Resend button with countdown */}
            <div className="pt-2 flex flex-col items-center gap-2 border-t border-slate-800">
              <button
                id="verify-reset-otp-resend-btn"
                type="button"
                onClick={handleResend}
                disabled={resending || cooldownSeconds > 0}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {resending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Sending code...</span>
                  </>
                ) : (
                  <>
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>
                      {cooldownSeconds > 0
                        ? `Resend code in ${cooldownSeconds}s`
                        : 'Resend verification code'}
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* Back links */}
            <div className="pt-2 flex items-center justify-between text-xs text-slate-400">
              <button
                id="verify-reset-otp-back-forgot-btn"
                type="button"
                onClick={onBackToForgotPassword}
                className="inline-flex items-center gap-1 hover:text-emerald-400 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Change Email</span>
              </button>

              {onNavigateLogin && (
                <button
                  id="verify-reset-otp-back-login-btn"
                  type="button"
                  onClick={onNavigateLogin}
                  className="hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  Return to Sign In
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
