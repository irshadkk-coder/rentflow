import React, { useEffect, useState } from 'react';
import {
  Car,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Mail,
  ArrowRight,
  ShieldCheck,
  KeyRound
} from 'lucide-react';
import { api } from '../lib/api.js';
import { EmailOtpVerification } from './EmailOtpVerification.js';

interface VerifyEmailViewProps {
  onNavigateLogin: () => void;
}

export const VerifyEmailView: React.FC<VerifyEmailViewProps> = ({ onNavigateLogin }) => {
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<'token' | 'otp'>('otp');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState<string>('');
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  // Email input for OTP mode when not provided in URL
  const [inputEmail, setInputEmail] = useState<string>('');
  const [activeOtpEmail, setActiveOtpEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const urlEmail = params.get('email');

    if (urlEmail) {
      setInputEmail(urlEmail);
      setActiveOtpEmail(urlEmail);
    }

    if (urlToken) {
      setToken(urlToken);
      setMode('token');
      setStatus('verifying');

      let isMounted = true;
      api.verifyEmail(urlToken)
        .then((res) => {
          if (!isMounted) return;
          setStatus('success');
          setMessage(res.message || 'Email verified successfully. You can now log in.');
          if (res.email) {
            setVerifiedEmail(res.email);
          }
        })
        .catch((err: any) => {
          if (!isMounted) return;
          setStatus('error');
          setMessage(err.message || 'Email verification failed. The link may have expired or is invalid.');
        });

      return () => {
        isMounted = false;
      };
    } else {
      setMode('otp');
      setStatus('verifying'); // default to show OTP form
    }
  }, []);

  const handleStartOtpWithEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputEmail.trim()) {
      setEmailError('Please enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputEmail.trim())) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    setEmailError(null);
    setActiveOtpEmail(inputEmail.trim().toLowerCase());
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden select-none">
      {/* Decorative gradient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-xl shadow-emerald-900/40 mb-4">
          <Car className="w-7 h-7" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
          RentFlow
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            SaaS
          </span>
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Owner Email Verification
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-8">

          {/* 1. LEGACY TOKEN VERIFICATION FLOW */}
          {mode === 'token' && (
            <>
              {status === 'verifying' && (
                <div className="text-center py-6 space-y-4">
                  <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mx-auto" />
                  <h2 className="text-lg font-bold text-white">Verifying your email...</h2>
                  <p className="text-xs text-slate-400">
                    Please wait while we validate your activation token.
                  </p>
                </div>
              )}

              {status === 'success' && (
                <div className="text-center py-4 space-y-5 animate-in fade-in duration-300">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-950">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Email Verified!</h2>
                    <p className="mt-2 text-xs text-slate-300 leading-relaxed font-medium">
                      {message}
                    </p>
                    {verifiedEmail && (
                      <p className="mt-2 text-[11px] text-emerald-400 font-mono bg-emerald-950/40 border border-emerald-800/40 py-1 px-2.5 rounded-lg inline-block">
                        {verifiedEmail}
                      </p>
                    )}
                  </div>

                  <button
                    id="verify-email-login-btn"
                    type="button"
                    onClick={onNavigateLogin}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all cursor-pointer"
                  >
                    <span>Proceed to Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {status === 'error' && (
                <div className="py-2 space-y-5 animate-in fade-in duration-300">
                  <div className="text-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <h2 className="text-lg font-bold text-white">Verification Link Expired or Invalid</h2>
                    <p className="text-xs text-rose-400 font-medium">
                      {message}
                    </p>
                  </div>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setMode('otp')}
                      className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                    >
                      &rarr; Verify using 6-Digit Code Instead
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 2. OTP VERIFICATION FLOW */}
          {mode === 'otp' && (
            <>
              {activeOtpEmail ? (
                <EmailOtpVerification
                  email={activeOtpEmail}
                  onNavigateLogin={onNavigateLogin}
                />
              ) : (
                /* Prompt for Email first */
                <form onSubmit={handleStartOtpWithEmail} className="space-y-4">
                  <div className="text-center space-y-1 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto mb-2">
                      <KeyRound className="w-6 h-6" />
                    </div>
                    <h2 className="text-lg font-bold text-white">Enter Your Account Email</h2>
                    <p className="text-xs text-slate-400">
                      Enter your registered email address to verify with your 6-digit code.
                    </p>
                  </div>

                  {emailError && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{emailError}</span>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="verify-email-input"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Owner Login Email *
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        id="verify-email-input"
                        type="email"
                        required
                        value={inputEmail}
                        onChange={(e) => {
                          setInputEmail(e.target.value);
                          setEmailError(null);
                        }}
                        placeholder="owner@company.com"
                        className="block w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all cursor-pointer"
                  >
                    <span>Continue to Code Verification</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  <div className="pt-2 text-center border-t border-slate-800">
                    <button
                      type="button"
                      onClick={onNavigateLogin}
                      className="text-xs text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                    >
                      &larr; Return to Sign In
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

        </div>

        {/* Security badge */}
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Role-Based Access Control • Isolated Multi-Tenancy</span>
        </div>
      </div>
    </div>
  );
};
