import React, { useState } from 'react';
import { Mail, ArrowRight, Loader2, AlertCircle, CheckCircle2, ArrowLeft, KeyRound } from 'lucide-react';
import { api } from '../lib/api.js';

interface ForgotPasswordViewProps {
  onOtpRequested?: (email: string) => void;
  onNavigateLogin: () => void;
}

export const ForgotPasswordView: React.FC<ForgotPasswordViewProps> = ({
  onOtpRequested,
  onNavigateLogin
}) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please provide your account email address.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.forgotPassword(cleanEmail);
      setSubmitted(true);
      setSubmittedEmail(cleanEmail);
      setSuccessMessage(res.message || 'If an account exists for this email, password reset instructions will be sent.');
    } catch (err: any) {
      setError(err.message || 'Unable to request password reset. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden select-none">
      {/* Decorative gradient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-xl shadow-emerald-900/40 mb-4">
          <KeyRound className="w-7 h-7" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
          Forgot Password
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Enter your email to receive a secure 6-digit verification code
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-8">
          {error && (
            <div
              id="forgot-password-error-alert"
              role="alert"
              className="mb-5 p-3.5 rounded-xl text-xs bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-start gap-2.5 animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
              <div className="flex-1 font-medium leading-relaxed">{error}</div>
            </div>
          )}

          {submitted ? (
            <div className="space-y-5 animate-in fade-in">
              <div
                id="forgot-password-success-box"
                className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-3"
              >
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-emerald-200">Request Received</p>
                  <p className="text-emerald-300/90 leading-relaxed">
                    {successMessage}
                  </p>
                </div>
              </div>

              <div className="text-xs text-slate-400 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                <p className="text-slate-300 font-medium">What's next?</p>
                <p>Check your inbox for a 6-digit code. The code will expire in 10 minutes.</p>
              </div>

              {onOtpRequested && (
                <button
                  id="forgot-password-proceed-otp-btn"
                  type="button"
                  onClick={() => onOtpRequested(submittedEmail)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all cursor-pointer"
                >
                  <span>Enter 6-Digit Code</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}

              <div className="pt-2 text-center">
                <button
                  id="forgot-password-back-login-btn"
                  type="button"
                  onClick={onNavigateLogin}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Return to Sign In</span>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="forgot-password-email-input"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Account Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="forgot-password-email-input"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="name@company.com"
                    aria-invalid={error ? 'true' : 'false'}
                    aria-describedby={error ? 'forgot-password-error-alert' : undefined}
                    className="block w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <button
                id="forgot-password-submit-btn"
                type="submit"
                disabled={loading}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending Code...</span>
                  </>
                ) : (
                  <>
                    <span>Send Verification Code</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <button
                  id="forgot-password-back-login-link"
                  type="button"
                  onClick={onNavigateLogin}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
