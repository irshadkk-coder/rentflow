import React, { useState, useEffect, useRef } from 'react';
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  KeyRound
} from 'lucide-react';
import { api } from '../lib/api.js';

interface EmailOtpVerificationProps {
  email: string;
  onNavigateLogin: () => void;
  onVerificationSuccess?: (email: string) => void;
  initialMessage?: string;
}

export const EmailOtpVerification: React.FC<EmailOtpVerificationProps> = ({
  email,
  onNavigateLogin,
  onVerificationSuccess,
  initialMessage = 'We sent a 6-digit verification code to your email.'
}) => {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isResending, setIsResending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(initialMessage);
  const [isVerified, setIsVerified] = useState<boolean>(false);
  const [cooldown, setCooldown] = useState<number>(60);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 60-second countdown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Focus the first empty digit input on initial mount
  useEffect(() => {
    if (!isVerified && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [isVerified]);

  const handleDigitChange = (index: number, value: string) => {
    // Only accept numeric digits
    const cleaned = value.replace(/\D/g, '');
    if (!cleaned) {
      const nextDigits = [...digits];
      nextDigits[index] = '';
      setDigits(nextDigits);
      return;
    }

    // Single digit input
    const char = cleaned.slice(-1);
    const nextDigits = [...digits];
    nextDigits[index] = char;
    setDigits(nextDigits);
    setErrorMessage(null);

    // Auto-advance focus to next input
    if (index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0 && inputRefs.current[index - 1]) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim();
    // Keep only numeric characters
    const numericChars = pastedData.replace(/\D/g, '').slice(0, 6);
    if (!numericChars) return;

    const nextDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      nextDigits[i] = numericChars[i] || '';
    }
    setDigits(nextDigits);
    setErrorMessage(null);

    // Focus last filled digit or the next empty one
    const targetIndex = Math.min(numericChars.length, 5);
    inputRefs.current[targetIndex]?.focus();
  };

  const otpCode = digits.join('');
  const isOtpComplete = otpCode.length === 6;

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isOtpComplete || isVerifying || isVerified) return;

    setIsVerifying(true);
    setErrorMessage(null);

    try {
      const res = await api.verifyEmailOtp({
        email: email.trim().toLowerCase(),
        otp: otpCode
      });

      setIsVerified(true);
      setInfoMessage(res.message || 'Email verified successfully! You can now sign in.');
      if (onVerificationSuccess) {
        onVerificationSuccess(email);
      }
    } catch (err: any) {
      const msg = err.message || 'Verification failed. Please check your code.';
      setErrorMessage(msg);
      // If code was expired or invalidated, clear digits to prompt fresh entry
      if (err.data?.codeInvalidated || err.data?.expired) {
        setDigits(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || isResending || isVerified) return;

    setIsResending(true);
    setErrorMessage(null);

    try {
      const res = await api.resendVerification(email.trim().toLowerCase());
      setInfoMessage(res.message || 'A new 6-digit verification code has been sent to your email.');
      setDigits(['', '', '', '', '', '']);
      setCooldown(60);
      inputRefs.current[0]?.focus();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resend verification code. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Header icon and title */}
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-xl shadow-emerald-950/60 mb-3">
          {isVerified ? (
            <CheckCircle2 className="w-7 h-7 text-emerald-400 animate-in zoom-in-75 duration-300" />
          ) : (
            <KeyRound className="w-7 h-7 text-emerald-400" />
          )}
        </div>
        <h2 className="text-xl font-bold text-white">
          {isVerified ? 'Email Verified Successfully!' : 'Enter Verification Code'}
        </h2>
        <p className="mt-1.5 text-xs text-slate-400">
          {isVerified
            ? 'Your account is active. Please proceed to sign in.'
            : 'Enter the 6-digit verification code sent to:'}
        </p>
        <div className="mt-2.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs font-mono text-emerald-400 shadow-inner">
          <Mail className="w-3.5 h-3.5 text-emerald-500" />
          <span>{email}</span>
        </div>
      </div>

      {/* SUCCESS STATE */}
      {isVerified ? (
        <div className="space-y-4 pt-2 animate-in fade-in duration-300">
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium">{infoMessage}</span>
          </div>

          <button
            id="otp-proceed-login-btn"
            type="button"
            onClick={onNavigateLogin}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-900/30 transition-all cursor-pointer"
          >
            <span>Proceed to Sign In</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* OTP ENTRY STATE */
        <form onSubmit={handleVerify} className="space-y-5">
          {/* Status and Error banners */}
          {errorMessage && (
            <div
              id="otp-error-alert"
              role="alert"
              className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-start gap-2 animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {!errorMessage && infoMessage && (
            <div
              id="otp-info-alert"
              className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-300 text-xs flex items-center gap-2"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span>{infoMessage}</span>
            </div>
          )}

          {/* Six digit OTP input boxes */}
          <div>
            <label className="block text-xs font-medium text-slate-300 text-center mb-2">
              Six-Digit Security Code
            </label>
            <div
              className="flex items-center justify-center gap-2 sm:gap-3"
              role="group"
              aria-label="6-digit verification code"
            >
              {digits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (inputRefs.current[idx] = el)}
                  id={`otp-digit-input-${idx}`}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  onPaste={handlePaste}
                  disabled={isVerifying}
                  aria-label={`Digit ${idx + 1} of 6`}
                  aria-invalid={!!errorMessage}
                  className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold font-mono rounded-xl bg-slate-950 border transition-all select-none
                    ${digit ? 'border-emerald-500 text-emerald-400' : 'border-slate-700 text-slate-100'}
                    ${errorMessage ? 'border-rose-500/60 focus:ring-rose-500' : 'focus:ring-2 focus:ring-emerald-500 focus:border-transparent'}
                    focus:outline-none disabled:opacity-50`}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-center text-slate-400">
              Code expires in 10 minutes. Paste code to autofill.
            </p>
          </div>

          {/* Action buttons */}
          <div className="space-y-2.5 pt-1">
            <button
              id="otp-verify-submit-btn"
              type="submit"
              disabled={!isOtpComplete || isVerifying}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying Code...</span>
                </>
              ) : (
                <>
                  <span>Verify Email</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>

            {/* Resend button with countdown */}
            <button
              id="otp-resend-btn"
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || isResending}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isResending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Requesting New Code...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    {cooldown > 0 ? `Resend Code in ${cooldown}s` : 'Resend Verification Code'}
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Back to sign in */}
          <div className="pt-2 text-center border-t border-slate-800">
            <button
              id="otp-back-to-login-btn"
              type="button"
              onClick={onNavigateLogin}
              className="text-xs text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
            >
              &larr; Return to Sign In
            </button>
          </div>
        </form>
      )}

      {/* Security footer notice */}
      <div className="pt-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>Single-Use &bull; Rate-Limited &bull; 10-Minute Expiration</span>
      </div>
    </div>
  );
};
