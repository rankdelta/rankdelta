/**
 * Reset Password Page
 *
 * Allows users to set a new password after clicking the reset link.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher';
import { useNavigate } from '@tanstack/react-router';
import { cameFromRecoveryLink, supabase } from '../lib/supabaseClient';
import { isValidPassword } from '../utils/validation';
import { PasswordRequirements } from '../components/auth/PasswordRequirements';
import { motion } from 'framer-motion';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';
import { setRobots } from '../lib/seoRobots';

export const ResetPasswordPage = () => {
  const { t, i18n } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Set new password · Rankdelta';
    setRobots('noindex, nofollow');
  }, []);

  // Check if user has a valid RECOVERY session. An ordinary logged-in session must NOT unlock the
  // form — only the PASSWORD_RECOVERY event or a recovery link in the URL does.
  useEffect(() => {
    // Implicit-flow links land as `#access_token=…&type=recovery`; GoTrue reports a bad link as
    // `#error=access_denied&error_code=otp_expired&…`. The client clears the hash and emits
    // PASSWORD_RECOVERY when it starts, often before this lazily loaded page mounts, so the
    // client module records it (cameFromRecoveryLink).
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    const param = (key: string) => hashParams.get(key) ?? searchParams.get(key);

    const errorCode = param('error_code');
    const errorDescription = param('error_description');
    if (param('error') || errorCode || errorDescription) {
      setLinkExpired(/expired/i.test(`${errorCode ?? ''} ${errorDescription ?? ''}`));
      setIsValidSession(false);
      return undefined;
    }

    // Listen for auth state changes (when user clicks recovery link)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, _session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsValidSession(true);
      }
    });

    if (param('type') === 'recovery' || cameFromRecoveryLink()) {
      // PASSWORD_RECOVERY may already have fired before this effect subscribed.
      setIsValidSession(true);
    } else {
      // Let the client finish restoring; if no recovery event arrived, the link is invalid.
      supabase.auth.getSession().then(() => {
        setIsValidSession((current) => current ?? false);
      });
    }

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidPassword(password)) {
      setError(t('passwordRules.errorTooWeak'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('resetPassword.errorMismatch'));
      return;
    }

    setIsLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        throw updateError;
      }

      // Revoke every other session for this user (the reset may have been triggered because the
      // account was compromised). Best effort — the password is already changed.
      try {
        await supabase.auth.signOut({ scope: 'others' });
      } catch {
        /* ignore */
      }

      setSuccess(true);

      // Redirect to dashboard after 3 seconds
      setTimeout(() => {
        navigate({ to: getDefaultAuthenticatedHomePath() as any });
      }, 3000);
    } catch (err) {
      console.error('Password update error:', err);
      // Surface the real reason when it's actionable (weak password, reused password, etc.)
      // instead of a generic failure the user can't act on.
      const message = err instanceof Error ? err.message : '';
      if (/reauthentication/i.test(message)) {
        // GoTrue: "Password update requires reauthentication" — the recovery session is gone.
        setError(t('resetPassword.errorReauth'));
      } else if (/password/i.test(message)) {
        if (/should be different|same as|different from/i.test(message)) {
          setError(t('resetPassword.errorMustDiffer'));
        } else {
          setError(t('passwordRules.errorTooWeak'));
        }
      } else {
        setError(t('resetPassword.errorFailed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  /* ── Shared background wrapper ── */
  const Background = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#080808' }}>
      {/* Language escape hatch */}
      <div className="fixed top-5 right-5 z-50">
        <LanguageSwitcher />
      </div>
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.6) 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-1/3 right-0 w-[500px] h-[500px] rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.5) 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.5) 0%, transparent 70%)' }}
        />
      </div>
      {children}
    </div>
  );

  // Loading state while checking session
  if (isValidSession === null) {
    return (
      <Background>
        <div className="relative w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </Background>
    );
  }

  // Invalid or expired link
  if (!isValidSession) {
    return (
      <Background>
        <motion.div
          className="relative w-full max-w-md text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-8">
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-rose-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">{t('resetPassword.invalidTitle')}</h2>
            <p className="text-white/50 mb-6 text-sm">
              {t(linkExpired ? 'resetPassword.linkExpired' : 'resetPassword.invalidBody')}
            </p>
            <button
              onClick={() => navigate({ to: (i18n.language.startsWith('it') ? '/it/forgot-password' : '/forgot-password') as any })}
              className="px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all"
            >
              {t('resetPassword.requestNewLink')}
            </button>
          </div>
        </motion.div>
      </Background>
    );
  }

  return (
    <Background>
      <motion.div
        className="relative w-full max-w-md"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-8">
          {/* Wordmark */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-white/60 font-mono text-sm select-none">✦/</span>
            <span className="text-white font-semibold tracking-tight text-lg">rankdelta.ai</span>
          </div>
          <p className="text-white/50 mb-8 text-sm">{t('resetPassword.subtitle')}</p>

          {success ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">{t('resetPassword.successTitle')}</h2>
              <p className="text-white/50 mb-6 text-sm">
                {t('resetPassword.successBody')}
              </p>
              <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
            </motion.div>
          ) : (
            <>
              <p className="text-white/40 mb-6 text-sm">
                {t('resetPassword.helper')}
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-white/60 mb-2">
                    {t('resetPassword.newPasswordLabel')}
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl focus:outline-none focus:border-violet-500/50 text-white placeholder-white/30 transition-all"
                    placeholder="••••••••"
                  />
                  <PasswordRequirements password={password} />
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-white/60 mb-2">
                    {t('resetPassword.confirmPasswordLabel')}
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl focus:outline-none focus:border-violet-500/50 text-white placeholder-white/30 transition-all"
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm flex items-center gap-2">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? t('resetPassword.updating') : t('resetPassword.updatePassword')}
                </button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </Background>
  );
};

export default ResetPasswordPage;
