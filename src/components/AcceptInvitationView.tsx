import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  Lock,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
  Building2,
  Mail,
  User,
  Check,
  X,
  Eye,
  EyeOff
} from 'lucide-react';
import { api } from '../lib/api.js';

interface AcceptInvitationViewProps {
  onAcceptSuccess: () => void;
  onNavigateLogin: () => void;
}

export const AcceptInvitationView: React.FC<AcceptInvitationViewProps> = ({
  onAcceptSuccess,
  onNavigateLogin,
}) => {
  const [token, setToken] = useState<string>('');
  const [isValidating, setIsValidating] = useState<boolean>(true);
  const [invitationData, setInvitationData] = useState<{
    email: string;
    name: string;
    role: string;
    tenantName: string;
    expiresAt: string;
  } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Form State
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const rawToken = urlParams.get('token') || '';
    setToken(rawToken);

    if (!rawToken) {
      setValidationError('No invitation token was provided in the URL. Please verify the invitation link from your email.');
      setIsValidating(false);
      return;
    }

    // Validate token with backend
    api.validateTeamInvitation(rawToken)
      .then((data) => {
        setInvitationData(data);
        setIsValidating(false);
      })
      .catch((err) => {
        setValidationError(err.message || 'This invitation is invalid or has expired.');
        setIsValidating(false);
      });
  }, []);

  // Password rules validation
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
  const isFormValid = hasMinLength && hasLetter && hasNumber && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!isFormValid) {
      setSubmitError('Please ensure your password satisfies all security requirements.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.acceptTeamInvitation({
        token,
        password
      });
      onAcceptSuccess();
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to accept invitation. Please try again or request a new invite.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden select-none">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-gradient-to-tr from-emerald-600/15 to-teal-500/15 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        {/* Brand Header */}
        <div className="flex justify-center mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-xl shadow-emerald-950/40">
              <KeyRound className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-black text-white tracking-tight">RENTFLOW</span>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded ml-1.5">
                Team Invite
              </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          {isValidating ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-semibold text-slate-400">Verifying your invitation token...</p>
            </div>
          ) : validationError ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/20">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-white">Invitation Unavailable</h2>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                {validationError}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onNavigateLogin}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                >
                  Return to Sign In
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-center mb-6">
                <h2 className="text-xl font-extrabold text-white tracking-tight">
                  Join {invitationData?.tenantName || 'RentFlow'}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  You've been invited as <span className="font-bold text-emerald-400 uppercase">{invitationData?.role}</span>
                </p>
              </div>

              {/* Invited Profile Details Card */}
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 mb-6 text-xs space-y-1.5">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    <span>Name</span>
                  </span>
                  <span className="font-bold text-slate-200">{invitationData?.name}</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-500" />
                    <span>Email</span>
                  </span>
                  <span className="font-mono text-slate-300 text-[11px]">{invitationData?.email}</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Organization</span>
                  </span>
                  <span className="font-bold text-slate-200">{invitationData?.tenantName}</span>
                </div>
              </div>

              {submitError && (
                <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Set Your Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-3 pr-10 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Confirm Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                  />
                </div>

                {/* Password Criteria Checklist */}
                <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/60 space-y-1.5 text-[11px]">
                  <div className="font-semibold text-slate-400 text-[10px] uppercase tracking-wider mb-1">
                    Password Requirements:
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
                    {hasMinLength ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                    <span>At least 8 characters</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasLetter ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
                    {hasLetter ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                    <span>Contains at least one letter</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
                    {hasNumber ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                    <span>Contains at least one number</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${passwordsMatch ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
                    {passwordsMatch ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                    <span>Passwords match</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !isFormValid}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-950/50 transition-all cursor-pointer flex items-center justify-center gap-2 mt-4"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Activating Account...</span>
                    </>
                  ) : (
                    <>
                      <span>Accept Invitation & Enter RentFlow</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={onNavigateLogin}
                  className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  Already have an account? Sign in
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
