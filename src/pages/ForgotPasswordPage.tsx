/**
 * Forgot Password Page
 *
 * Allows users to request a password reset link.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../lib/supabaseClient';
import { isValidEmail, sanitizeString } from '../utils/validation';
import { motion } from 'framer-motion';
import { setRobots } from '../lib/seoRobots';

export const ForgotPasswordPage = () => {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = i18n.language.startsWith('it') ? 'Password dimenticata · Rankdelta' : 'Forgot password · Rankdelta';
    setRobots('noindex, nofollow');
  }, [i18n.language]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const sanitizedEmail = sanitizeString(email);

    if (!isValidEmail(sanitizedEmail)) {
      setError(t('forgotPassword.errorInvalidEmail'));
      return;
    }

    setIsLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        sanitizedEmail,
        {
          // The Supabase "Reset password" email template branches on this path to write the
          // email in Italian (/it/reset-password) or English — keep the two in sync.
          redirectTo: `${window.location.origin}${i18n.language.startsWith('it') ? '/it' : ''}/reset-password`,
        }
      );

      if (resetError) {
        throw resetError;
      }

      setSuccess(true);
    } catch (err) {
      console.error('Password reset error:', err);
      // GoTrue allows one email a minute ("For security purposes, you can only request this after …").
      const message = err instanceof Error ? err.message : '';
      setError(t(/only request this after|rate limit/i.test(message) ? 'forgotPassword.errorRateLimited' : 'forgotPassword.errorFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#080808' }}>
      {/* Language escape hatch */}
      <div className="fixed top-5 right-5 z-50">
        <LanguageSwitcher />
      </div>
      {/* Ambient gradient blobs */}
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
          <p className="text-white/50 mb-8 text-sm">{t('forgotPassword.subtitle')}</p>

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
              <h2 className="text-xl font-bold text-white mb-2">{t('forgotPassword.checkEmailTitle')}</h2>
              <p className="text-white/50 mb-6 text-sm">
                {t('forgotPassword.sentTo')} <strong className="text-white/80">{email}</strong>.{' '}
                {t('forgotPassword.checkInbox')}
              </p>
              <button
                onClick={() => navigate({ to: '/login' as any })}
                className="text-violet-400 hover:text-violet-300 font-medium transition-colors text-sm"
              >
                {t('forgotPassword.backToLogin')}
              </button>
            </motion.div>
          ) : (
            <>
              <p className="text-white/40 mb-6 text-sm">
                {t('forgotPassword.intro')}
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-white/60 mb-2">
                    {t('forgotPassword.emailLabel')}
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl focus:outline-none focus:border-violet-500/50 text-white placeholder-white/30 transition-all"
                    placeholder={t('common.emailPlaceholder')}
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
                  {isLoading ? t('forgotPassword.sending') : t('forgotPassword.sendResetLink')}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-white/40">
                {t('forgotPassword.rememberPassword')}{' '}
                <a href="/login" className="text-violet-400 hover:text-violet-300 font-medium transition-colors">
                  {t('forgotPassword.signIn')}
                </a>
              </p>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default ForgotPasswordPage;
