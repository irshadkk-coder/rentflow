import React, { useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';

interface ResetPasswordViewProps {
  email: string;
  resetToken: string;
  onResetSuccess: () => void;
  onNavigateLogin: () => void;
}

export const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({
  email,
  resetToken,
  onResetSuccess,
  onNavigateLogin
}) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handlePasswordChange = (val: string) => {
    setNewPassword(val);
    if (fieldErrors['newPassword'] || fieldErrors['password']) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next['newPassword'];
        delete next['password'];
        return next;
      });
    }
  };

  const handleConfirmPasswordChange = (val: string) => {
    setConfirmPassword(val);
    if (fieldErrors['confirmPassword']) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next['confirmPassword'];
        return next;
      });
    }
  };

  const validateClientSide = (): boolean => {
    const errors: Record<string, string> = {};

    if (!newPassword) {
      errors['newPassword'] = 'Password is required.';
    } else if (newPassword.length < 8) {
      errors['newPassword'] = 'Password must be at least 8 characters long.';
    } else if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      errors['newPassword'] = 'Password must contain at least one letter and one number.';
    }

    if (!confirmPassword) {
      errors['confirmPassword'] = 'Please confirm your password.';
    } else if (newPassword !== confirmPassword) {
      errors['confirmPassword'] = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    if (!validateClientSide()) {
      return;
    }

    setLoading(true);

    try {
      await api.resetPassword({
        email: email.trim(),
        resetToken: resetToken.trim(),
        newPassword,
        confirmPassword
      });
      setSuccess(true);
      onResetSuccess();
    } catch (err: any) {
      if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors);
      } else {
        setGeneralError(err.message || 'Failed to reset password. Please try again or request a new code.');
      }
    } finally {
      setLoading(false);
    }
  };

  const passwordError = fieldErrors['newPassword'] || fieldErrors['password'];
  const confirmPasswordError = fieldErrors['confirmPassword'];

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden select-none">
      {/* Decorative gradient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-xl shadow-emerald-900/40 mb-4">
          <Lock className="w-7 h-7" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
          Set New Password
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Create a secure new password for your account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-8">
          {generalError && (
            <div
              id="reset-password-general-error-alert"
              role="alert"
              className="mb-5 p-3.5 rounded-xl text-xs bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-start gap-2.5 animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
              <div className="flex-1 font-medium leading-relaxed">{generalError}</div>
            </div>
          )}

          {success ? (
            <div className="space-y-5 text-center animate-in fade-in">
              <div className="w-12 h-12 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/30">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Password Reset Complete</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Your password has been securely updated. You can now log in using your new credentials.
                </p>
              </div>

              <button
                id="reset-password-login-btn"
                type="button"
                onClick={onNavigateLogin}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all cursor-pointer"
              >
                <span>Proceed to Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* New Password */}
              <div>
                <label
                  htmlFor="reset-new-password-input"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  New Password <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="reset-new-password-input"
                    name="newPassword"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => handlePasswordChange(e.target.value)}
                    placeholder="At least 8 chars, letter & number"
                    aria-invalid={passwordError ? 'true' : 'false'}
                    aria-describedby={passwordError ? 'reset-new-password-error' : undefined}
                    className={`block w-full pl-9 pr-10 py-2.5 bg-slate-950 border rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                      passwordError
                        ? 'border-rose-500 focus:ring-rose-500/30 focus:border-rose-500'
                        : 'border-slate-700 focus:ring-emerald-500 focus:border-transparent'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordError && (
                  <p
                    id="reset-new-password-error"
                    role="alert"
                    className="mt-1.5 text-xs text-rose-400 flex items-center gap-1 animate-in fade-in"
                  >
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{passwordError}</span>
                  </p>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label
                  htmlFor="reset-confirm-password-input"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Confirm Password <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="reset-confirm-password-input"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => handleConfirmPasswordChange(e.target.value)}
                    placeholder="Re-enter your new password"
                    aria-invalid={confirmPasswordError ? 'true' : 'false'}
                    aria-describedby={confirmPasswordError ? 'reset-confirm-password-error' : undefined}
                    className={`block w-full pl-9 pr-10 py-2.5 bg-slate-950 border rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                      confirmPasswordError
                        ? 'border-rose-500 focus:ring-rose-500/30 focus:border-rose-500'
                        : 'border-slate-700 focus:ring-emerald-500 focus:border-transparent'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPasswordError && (
                  <p
                    id="reset-confirm-password-error"
                    role="alert"
                    className="mt-1.5 text-xs text-rose-400 flex items-center gap-1 animate-in fade-in"
                  >
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{confirmPasswordError}</span>
                  </p>
                )}
              </div>

              <button
                id="reset-password-submit-btn"
                type="submit"
                disabled={loading}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <>
                    <span>Reset Password</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <button
                  id="reset-password-back-login-link"
                  type="button"
                  onClick={onNavigateLogin}
                  className="text-xs font-semibold text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  Return to Sign In
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
