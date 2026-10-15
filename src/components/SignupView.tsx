import React, { useState } from 'react';
import {
  Building2,
  User as UserIcon,
  Lock,
  Mail,
  Phone,
  ArrowRight,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Car,
  Globe
} from 'lucide-react';
import { api } from '../lib/api.js';
import { User, Tenant } from '../types.js';
import { BotVerification } from './BotVerification.js';
import { EmailOtpVerification } from './EmailOtpVerification.js';

interface SignupViewProps {
  onSignupSuccess?: (data: { token?: string; user?: User; tenant?: Tenant }) => void;
  onNavigateLogin: () => void;
  onOpenStorefront?: () => void;
}

export const SignupView: React.FC<SignupViewProps> = ({
  onSignupSuccess,
  onNavigateLogin,
  onOpenStorefront
}) => {
  const [companyName, setCompanyName] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Field-specific validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Bot protection state
  const [captchaToken, setCaptchaToken] = useState<string>('');
  const [isCaptchaVerified, setIsCaptchaVerified] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Email verification pending state
  const [verificationPendingEmail, setVerificationPendingEmail] = useState<string | null>(null);

  const clearFieldError = (field: string) => {
    if (fieldErrors[field]) {
      setFieldErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validateClientSide = (): boolean => {
    const errors: Record<string, string> = {};

    // 1. Company Name
    const trimmedComp = companyName.trim();
    if (!trimmedComp) {
      errors.companyName = 'Company name is required.';
    } else if (trimmedComp.length < 2) {
      errors.companyName = 'Company name must be at least 2 characters long.';
    }

    // 2. Company Contact Email
    const trimmedCompEmail = companyEmail.trim();
    if (!trimmedCompEmail) {
      errors.companyEmail = 'Company contact email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedCompEmail)) {
      errors.companyEmail = 'Please provide a valid company contact email address.';
    }

    // 3. Business Phone
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      errors.phone = 'Business phone number is required.';
    } else if (trimmedPhone.length < 5) {
      errors.phone = 'Please provide a valid contact phone number.';
    }

    // 4. Owner Full Name
    const trimmedOwnerName = ownerName.trim();
    if (!trimmedOwnerName) {
      errors.ownerName = 'Owner full name is required.';
    }

    // 5. Owner Login Email
    const trimmedOwnerEmail = ownerEmail.trim();
    if (!trimmedOwnerEmail) {
      errors.ownerEmail = 'Owner login email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedOwnerEmail)) {
      errors.ownerEmail = 'Please provide a valid email address.';
    }

    // 6. Password
    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters long.';
    } else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      errors.password = 'Password must contain at least one letter and one number.';
    }

    // 7. Confirm Password
    if (!confirmPassword) {
      errors.confirmPassword = 'Confirm password is required.';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    const isValid = validateClientSide();
    if (!isValid) {
      return;
    }

    if (!isCaptchaVerified || !captchaToken) {
      setGeneralError('Please complete the bot protection challenge.');
      return;
    }

    setLoading(true);
    try {
      await api.register({
        companyName: companyName.trim(),
        companyEmail: companyEmail.trim().toLowerCase(),
        phone: phone.trim(),
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim().toLowerCase(),
        password,
        confirmPassword,
        captchaToken,
      });

      // Transition to OTP verification screen
      setVerificationPendingEmail(ownerEmail.trim().toLowerCase());
    } catch (err: any) {
      // Single-use token reset
      setCaptchaToken('');
      setIsCaptchaVerified(false);
      if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors);
        // Avoid displaying duplicate errors in top-level banner
        const fieldErrorValues = Object.values(err.fieldErrors);
        if (err.message && !fieldErrorValues.includes(err.message)) {
          setGeneralError(err.message);
        }
      } else {
        setGeneralError(err.message || 'Registration failed. Please check your details.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-10 sm:px-6 lg:px-8 relative overflow-hidden select-none">
      {/* Decorative gradient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-lg relative z-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-xl shadow-emerald-900/40 mb-3">
          <Car className="w-7 h-7" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
          Start with RentFlow
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            SaaS
          </span>
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Create a new tenant workspace and launch your fleet in minutes
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-lg relative z-10 px-4 sm:px-0">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-8">

          {/* VERIFICATION PENDING OTP SCREEN */}
          {verificationPendingEmail ? (
            <EmailOtpVerification
              email={verificationPendingEmail}
              onNavigateLogin={onNavigateLogin}
            />
          ) : (
            /* SIGNUP FORM */
            <>
              {generalError && (
                <div
                  id="signup-error-alert"
                  role="alert"
                  className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-start gap-2.5 animate-in fade-in"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
                  <div className="flex-1 leading-relaxed font-medium">{generalError}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                {/* 1. Business Workspace Section */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Business Details</span>
                  </div>

                  <div>
                    <label
                      htmlFor="signup-company-name-input"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Company / Rental Business Name *
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                        <Building2 className="w-4 h-4" />
                      </div>
                      <input
                        id="signup-company-name-input"
                        type="text"
                        required
                        value={companyName}
                        onChange={(e) => {
                          setCompanyName(e.target.value);
                          clearFieldError('companyName');
                        }}
                        aria-invalid={!!fieldErrors.companyName}
                        aria-describedby={fieldErrors.companyName ? "signup-company-name-error" : undefined}
                        placeholder="e.g. Himalayan Expeditions"
                        className={`block w-full pl-9 pr-3 py-2 bg-slate-950 border rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                          fieldErrors.companyName
                            ? 'border-rose-500/60 focus:ring-rose-500 focus:border-rose-500'
                            : 'border-slate-700 focus:ring-emerald-500 focus:border-transparent'
                        }`}
                      />
                    </div>
                    {fieldErrors.companyName && (
                      <p
                        id="signup-company-name-error"
                        role="alert"
                        className="mt-1 text-xs text-rose-400 font-medium flex items-center gap-1.5 animate-in fade-in"
                      >
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{fieldErrors.companyName}</span>
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="signup-company-email-input"
                        className="block text-xs font-medium text-slate-300 mb-1"
                      >
                        Company Contact Email *
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <Mail className="w-4 h-4" />
                        </div>
                        <input
                          id="signup-company-email-input"
                          type="email"
                          required
                          value={companyEmail}
                          onChange={(e) => {
                            setCompanyEmail(e.target.value);
                            clearFieldError('companyEmail');
                          }}
                          aria-invalid={!!fieldErrors.companyEmail}
                          aria-describedby={fieldErrors.companyEmail ? "signup-company-email-error" : undefined}
                          placeholder="info@company.com"
                          className={`block w-full pl-9 pr-3 py-2 bg-slate-950 border rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                            fieldErrors.companyEmail
                              ? 'border-rose-500/60 focus:ring-rose-500 focus:border-rose-500'
                              : 'border-slate-700 focus:ring-emerald-500 focus:border-transparent'
                          }`}
                        />
                      </div>
                      {fieldErrors.companyEmail && (
                        <p
                          id="signup-company-email-error"
                          role="alert"
                          className="mt-1 text-xs text-rose-400 font-medium flex items-center gap-1.5 animate-in fade-in"
                        >
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{fieldErrors.companyEmail}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="signup-phone-input"
                        className="block text-xs font-medium text-slate-300 mb-1"
                      >
                        Business Phone *
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <Phone className="w-4 h-4" />
                        </div>
                        <input
                          id="signup-phone-input"
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => {
                            setPhone(e.target.value);
                            clearFieldError('phone');
                          }}
                          aria-invalid={!!fieldErrors.phone}
                          aria-describedby={fieldErrors.phone ? "signup-phone-error" : undefined}
                          placeholder="+91 98765 43210"
                          className={`block w-full pl-9 pr-3 py-2 bg-slate-950 border rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                            fieldErrors.phone
                              ? 'border-rose-500/60 focus:ring-rose-500 focus:border-rose-500'
                              : 'border-slate-700 focus:ring-emerald-500 focus:border-transparent'
                          }`}
                        />
                      </div>
                      {fieldErrors.phone && (
                        <p
                          id="signup-phone-error"
                          role="alert"
                          className="mt-1 text-xs text-rose-400 font-medium flex items-center gap-1.5 animate-in fade-in"
                        >
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{fieldErrors.phone}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. Owner Account Section */}
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1 flex items-center gap-1.5">
                    <UserIcon className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Owner Account Credentials</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="signup-owner-name-input"
                        className="block text-xs font-medium text-slate-300 mb-1"
                      >
                        Owner Full Name *
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <UserIcon className="w-4 h-4" />
                        </div>
                        <input
                          id="signup-owner-name-input"
                          type="text"
                          required
                          value={ownerName}
                          onChange={(e) => {
                            setOwnerName(e.target.value);
                            clearFieldError('ownerName');
                          }}
                          aria-invalid={!!fieldErrors.ownerName}
                          aria-describedby={fieldErrors.ownerName ? "signup-owner-name-error" : undefined}
                          placeholder="e.g. Tenzing Norgay"
                          className={`block w-full pl-9 pr-3 py-2 bg-slate-950 border rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                            fieldErrors.ownerName
                              ? 'border-rose-500/60 focus:ring-rose-500 focus:border-rose-500'
                              : 'border-slate-700 focus:ring-emerald-500 focus:border-transparent'
                          }`}
                        />
                      </div>
                      {fieldErrors.ownerName && (
                        <p
                          id="signup-owner-name-error"
                          role="alert"
                          className="mt-1 text-xs text-rose-400 font-medium flex items-center gap-1.5 animate-in fade-in"
                        >
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{fieldErrors.ownerName}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="signup-owner-email-input"
                        className="block text-xs font-medium text-slate-300 mb-1"
                      >
                        Owner Login Email *
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <Mail className="w-4 h-4" />
                        </div>
                        <input
                          id="signup-owner-email-input"
                          type="email"
                          required
                          value={ownerEmail}
                          onChange={(e) => {
                            setOwnerEmail(e.target.value);
                            clearFieldError('ownerEmail');
                          }}
                          aria-invalid={!!fieldErrors.ownerEmail}
                          aria-describedby={fieldErrors.ownerEmail ? "signup-owner-email-error" : undefined}
                          placeholder="owner@company.com"
                          className={`block w-full pl-9 pr-3 py-2 bg-slate-950 border rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                            fieldErrors.ownerEmail
                              ? 'border-rose-500/60 focus:ring-rose-500 focus:border-rose-500'
                              : 'border-slate-700 focus:ring-emerald-500 focus:border-transparent'
                          }`}
                        />
                      </div>
                      {fieldErrors.ownerEmail && (
                        <p
                          id="signup-owner-email-error"
                          role="alert"
                          className="mt-1 text-xs text-rose-400 font-medium flex items-center gap-1.5 animate-in fade-in"
                        >
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{fieldErrors.ownerEmail}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="signup-password-input"
                        className="block text-xs font-medium text-slate-300 mb-1"
                      >
                        Password *
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                          <Lock className="w-3.5 h-3.5" />
                        </div>
                        <input
                          id="signup-password-input"
                          type="password"
                          required
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            clearFieldError('password');
                            if (confirmPassword && confirmPassword === e.target.value) {
                              clearFieldError('confirmPassword');
                            }
                          }}
                          aria-invalid={!!fieldErrors.password}
                          aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
                          placeholder="Min 8 chars, 1 letter & 1 number"
                          className={`block w-full pl-8 pr-3 py-2 bg-slate-950 border rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                            fieldErrors.password
                              ? 'border-rose-500/60 focus:ring-rose-500 focus:border-rose-500'
                              : 'border-slate-700 focus:ring-emerald-500 focus:border-transparent'
                          }`}
                        />
                      </div>
                      {fieldErrors.password && (
                        <p
                          id="signup-password-error"
                          role="alert"
                          className="mt-1 text-xs text-rose-400 font-medium flex items-center gap-1.5 animate-in fade-in"
                        >
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{fieldErrors.password}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="signup-confirm-password-input"
                        className="block text-xs font-medium text-slate-300 mb-1"
                      >
                        Confirm Password *
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                          <Lock className="w-3.5 h-3.5" />
                        </div>
                        <input
                          id="signup-confirm-password-input"
                          type="password"
                          required
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            clearFieldError('confirmPassword');
                          }}
                          aria-invalid={!!fieldErrors.confirmPassword}
                          aria-describedby={fieldErrors.confirmPassword ? "signup-confirm-password-error" : undefined}
                          placeholder="Confirm password"
                          className={`block w-full pl-8 pr-3 py-2 bg-slate-950 border rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                            fieldErrors.confirmPassword
                              ? 'border-rose-500/60 focus:ring-rose-500 focus:border-rose-500'
                              : 'border-slate-700 focus:ring-emerald-500 focus:border-transparent'
                          }`}
                        />
                      </div>
                      {fieldErrors.confirmPassword && (
                        <p
                          id="signup-confirm-password-error"
                          role="alert"
                          className="mt-1 text-xs text-rose-400 font-medium flex items-center gap-1.5 animate-in fade-in"
                        >
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{fieldErrors.confirmPassword}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cloudflare Turnstile Bot Verification */}
                <div className="pt-2">
                  <BotVerification
                    isVerified={isCaptchaVerified}
                    onVerify={(token: string) => {
                      setCaptchaToken(token);
                      setIsCaptchaVerified(true);
                      setGeneralError(null);
                    }}
                    onExpireOrReset={() => {
                      setCaptchaToken('');
                      setIsCaptchaVerified(false);
                    }}
                  />
                </div>

                {/* Currency & Region Notice */}
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                  <span>Workspace defaults to Indian Rupees (INR ₹) and Asia/Kolkata timezone.</span>
                </div>

                <button
                  id="signup-submit-btn"
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating Workspace & Tenant...</span>
                    </>
                  ) : (
                    <>
                      <span>Create Account</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Already have an account link */}
              <div className="mt-5 pt-4 border-t border-slate-800 text-center">
                <span className="text-xs text-slate-400">Already have an account? </span>
                <button
                  id="signup-login-link"
                  type="button"
                  onClick={onNavigateLogin}
                  className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
                >
                  Sign in
                </button>
              </div>

              {/* Customer Storefront Link */}
              {onOpenStorefront && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={onOpenStorefront}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 transition-colors cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Customer looking to book? Open Public Storefront</span>
                  </button>
                </div>
              )}
            </>
          )}

        </div>

        {/* Security badge footer */}
        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Role-Based Access Control • Isolated Multi-Tenancy</span>
        </div>
      </div>
    </div>
  );
};
