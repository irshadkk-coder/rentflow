import React, { useState } from 'react';
import {
  ShieldCheck,
  Car,
  Key,
  Lock,
  Eye,
  EyeOff,
  Mail,
  ArrowRight,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Globe,
  Sparkles
} from 'lucide-react';
import { api } from '../lib/api.js';
import { User } from '../types.js';
import { isDemoModeActive } from '../lib/auth-utils.js';

interface LoginViewProps {
  onLoginSuccess: (user: User) => void;
  onNavigateSignup?: () => void;
  onNavigateForgotPassword?: () => void;
  onOpenStorefront?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  onLoginSuccess,
  onNavigateSignup,
  onNavigateForgotPassword,
  onOpenStorefront
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const DEMO_ACCOUNTS = !import.meta.env.PROD ? [
    {
      name: 'Alex Rivera',
      email: 'alex.rivera@apexrentals.com',
      role: 'Owner',
      tenant: 'Apex Ride & Drive Co.',
      badgeClass: 'bg-purple-100 text-purple-700'
    },
    {
      name: 'Sarah Chen',
      email: 'sarah.chen@apexrentals.com',
      role: 'Manager',
      tenant: 'Apex Ride & Drive Co.',
      badgeClass: 'bg-blue-100 text-blue-700'
    },
    {
      name: 'Jordan Lee',
      email: 'jordan.lee@apexrentals.com',
      role: 'Staff',
      tenant: 'Apex Ride & Drive Co.',
      badgeClass: 'bg-slate-100 text-slate-600'
    },
    {
      name: 'Maya Lin',
      email: 'maya.lin@coastalrentals.com',
      role: 'Owner',
      tenant: 'Coastal Coast & Trail Rentals',
      badgeClass: 'bg-purple-100 text-purple-700'
    }
  ] : [];

  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState<boolean>(false);
  const [resendFeedback, setResendFeedback] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }

    setLoading(true);
    setError(null);
    setUnverifiedEmail(null);
    setResendFeedback(null);
    try {
      const res = await api.login(email.trim(), password);
      onLoginSuccess(res.user);
    } catch (err: any) {
      if (err.unverified) {
        setUnverifiedEmail(err.email || email.trim());
        setError(err.message || 'Please verify your email before logging in.');
      } else {
        setError(err.message || 'Authentication failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!unverifiedEmail) return;
    setResending(true);
    setResendFeedback(null);
    try {
      const res = await api.resendVerification(unverifiedEmail);
      setResendFeedback(res.message || 'Verification email sent. Please check your inbox.');
    } catch (err: any) {
      setResendFeedback(err.message || 'Failed to send verification email.');
    } finally {
      setResending(false);
    }
  };

  const handleSelectDemoAccount = (demoEmail: string) => {
    setEmail(demoEmail);
    if (!import.meta.env.PROD) {
      setPassword('Password123!');
    }
    setError(null);
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
          Sign in to manage fleet operations, reservations & revenue
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-8">
          {error && (
            <div
              id="login-error-alert"
              className={`mb-5 p-3.5 rounded-xl text-xs flex flex-col gap-2.5 animate-in fade-in ${
                unverifiedEmail
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${unverifiedEmail ? 'text-amber-400' : 'text-rose-400'}`} />
                <div className="flex-1 leading-relaxed font-medium">{error}</div>
              </div>

              {unverifiedEmail && (
                <div className="pt-2 border-t border-amber-500/20 flex flex-col gap-2">
                  <button
                    id="login-resend-verification-btn"
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {resending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Sending Link...</span>
                      </>
                    ) : (
                      <>
                        <Mail className="w-3.5 h-3.5" />
                        <span>Resend Verification Email</span>
                      </>
                    )}
                  </button>

                  {resendFeedback && (
                    <div className="text-[11px] text-emerald-400 font-medium">
                      {resendFeedback}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-email-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Work Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="login-email-input"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="block w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Password
                </label>
                {onNavigateForgotPassword && (
                  <button
                    id="login-forgot-password-link"
                    type="button"
                    onClick={onNavigateForgotPassword}
                    className="text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="login-password-input"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-9 pr-10 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  id="login-password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Sign Up Link */}
          <div className="mt-4 text-center">
            <span className="text-xs text-slate-400">Don't have an account? </span>
            <button
              id="login-signup-link"
              type="button"
              onClick={onNavigateSignup}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
            >
              Create your business account
            </button>
          </div>

          {/* Quick Demo Accounts Selection (Development Mode Only) */}
          {!import.meta.env.PROD && isDemoModeActive() && DEMO_ACCOUNTS.length > 0 && (
            <div className="mt-6 pt-5 border-t border-slate-800">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Select Demo Account
                </span>
                <span className="text-[10px] text-emerald-400 font-medium">Click to fill</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((acc) => {
                  const isSelected = email === acc.email;
                  return (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => handleSelectDemoAccount(acc.email)}
                      className={`p-2 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-emerald-950/40 border-emerald-500/50 text-white ring-1 ring-emerald-500/30'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-semibold truncate text-slate-200">
                          {acc.name}
                        </span>
                        <span className={`text-[9px] font-bold uppercase px-1 py-0.2 rounded ${acc.badgeClass}`}>
                          {acc.role}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 truncate">
                        {acc.tenant.split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Customer Storefront Link */}
          {onOpenStorefront && (
            <div className="mt-5 pt-4 border-t border-slate-800/80 text-center">
              <button
                type="button"
                onClick={onOpenStorefront}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 text-emerald-500" />
                <span>Customer looking to book a vehicle? Open Public Storefront</span>
              </button>
            </div>
          )}
        </div>

        {/* Security badge footer */}
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Role-Based Access Control • Isolated Multi-Tenancy</span>
        </div>
      </div>
    </div>
  );
};
