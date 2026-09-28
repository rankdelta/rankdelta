/**
 * Help & Support Page — dark theme via AppShell.
 *
 * FAQ, documentation, and contact form.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from '@tanstack/react-router';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../hooks/useAuth';
import { isSelfHost } from '../config/deployment';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

// Stable, fully-literal i18n keys for each FAQ entry. Display strings are resolved via i18n.
const faqMeta = [
  // Getting Started
  { categoryKey: 'helpPage.categoryGettingStarted', questionKey: 'helpPage.q1Question', answerKey: 'helpPage.q1Answer' },
  { categoryKey: 'helpPage.categoryGettingStarted', questionKey: 'helpPage.q2Question', answerKey: 'helpPage.q2Answer' },
  { categoryKey: 'helpPage.categoryGettingStarted', questionKey: 'helpPage.q3Question', answerKey: 'helpPage.q3Answer' },
  // Content Generation
  { categoryKey: 'helpPage.categoryContentGeneration', questionKey: 'helpPage.q4Question', answerKey: 'helpPage.q4Answer' },
  { categoryKey: 'helpPage.categoryContentGeneration', questionKey: 'helpPage.q5Question', answerKey: 'helpPage.q5Answer' },
  { categoryKey: 'helpPage.categoryContentGeneration', questionKey: 'helpPage.q6Question', answerKey: 'helpPage.q6Answer' },
  // SEO & Tracking
  { categoryKey: 'helpPage.categorySeoTracking', questionKey: 'helpPage.q7Question', answerKey: 'helpPage.q7Answer' },
  { categoryKey: 'helpPage.categorySeoTracking', questionKey: 'helpPage.q8Question', answerKey: 'helpPage.q8Answer' },
  // Billing
  { categoryKey: 'helpPage.categoryBilling', questionKey: 'helpPage.q9Question', answerKey: 'helpPage.q9Answer' },
  { categoryKey: 'helpPage.categoryBilling', questionKey: 'helpPage.q10Question', answerKey: 'helpPage.q10Answer' },
  { categoryKey: 'helpPage.categoryBilling', questionKey: 'helpPage.q11Question', answerKey: 'helpPage.q11Answer' },
  // Technical
  { categoryKey: 'helpPage.categoryTechnical', questionKey: 'helpPage.q12Question', answerKey: 'helpPage.q12Answer' },
  { categoryKey: 'helpPage.categoryTechnical', questionKey: 'helpPage.q13Question', answerKey: 'helpPage.q13Answer' },
] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

// Plans, credits, refunds and the privacy policy belong to the hosted cloud, not to a self-hosted install.
const HOSTED_ONLY_FAQ: ReadonlySet<string> = new Set([
  'helpPage.q2Question', 'helpPage.q9Question', 'helpPage.q10Question', 'helpPage.q11Question', 'helpPage.q13Question',
]);
const visibleFaqMeta = isSelfHost() ? faqMeta.filter(meta => !HOSTED_ONLY_FAQ.has(meta.questionKey)) : faqMeta;

/** Support inbox (current Rankdelta brand). */
// Self-hosters point users at their own support with VITE_SUPPORT_EMAIL; without it the contact
// section is hidden rather than sending their users to the Rankdelta team.
const SUPPORT_EMAIL = (import.meta.env['VITE_SUPPORT_EMAIL'] as string | undefined)?.trim() || (isSelfHost() ? '' : 'info@rankdelta.ai');

export const HelpPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const faqs: FAQItem[] = visibleFaqMeta.map(meta => ({
    category: t(meta.categoryKey),
    question: t(meta.questionKey),
    answer: t(meta.answerKey),
  }));

  const categories = [...new Set(faqs.map(faq => faq.category))];
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [contactForm, setContactForm] = useState({
    subject: '',
    message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const filteredFaqs = faqs.filter(faq => {
    const matchesCategory = activeCategory === 'all' || faq.category === activeCategory;
    const matchesSearch = searchQuery === '' ||
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Actually deliver the message: open the user's mail client with a pre-filled email to
    // support (their own address is the sender). Replaces the previous fake "simulate submit"
    // that showed success without sending anything.
    const mailto =
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(contactForm.subject)}` +
      `&body=${encodeURIComponent(contactForm.message)}`;
    window.location.href = mailto;

    setIsSubmitting(false);
    setSubmitSuccess(true);
    setContactForm({ subject: '', message: '' });

    // Reset success message after 5 seconds
    setTimeout(() => setSubmitSuccess(false), 5000);
  };

  const mainContent = (
    <>
      {/* Header */}
      <div className="mb-10 text-center">
        <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-2">{t('helpPage.eyebrow')}</p>
        <h1 className="text-4xl font-bold text-white mb-3">{t('helpPage.title')}</h1>
        <p className="text-white/50 text-lg max-w-2xl mx-auto">
          {t('helpPage.subtitle')}
        </p>
      </div>

      {/* Search */}
      <div className="max-w-xl mx-auto mb-10">
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder={t('helpPage.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3.5 bg-white/[0.03] border border-white/[0.1] rounded-2xl focus:outline-none focus:border-violet-500/50 text-white placeholder-white/30 transition-colors"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 justify-center mb-8">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
            activeCategory === 'all'
              ? 'bg-white text-black'
              : 'border border-white/20 text-white/60 hover:text-white hover:border-white/40'
          }`}
        >
          {t('helpPage.categoryAll')}
        </button>
        {categories.map(category => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              activeCategory === category
                ? 'bg-white text-black'
                : 'border border-white/20 text-white/60 hover:text-white hover:border-white/40'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* FAQ Section */}
      <div className="mb-12">
        <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-5">{t('helpPage.faqEyebrow')}</p>
        <div className="space-y-2">
          {filteredFaqs.map((faq, index) => (
            <motion.div
              key={index}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden"
              initial={false}
            >
              <button
                onClick={() => setOpenFaq(openFaq === index ? null : index)}
                className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[10px] font-medium text-violet-400 bg-violet-500/10 px-2 py-1 rounded-full flex-shrink-0">
                    {faq.category}
                  </span>
                  <span className="font-medium text-white/80 truncate">{faq.question}</span>
                </div>
                <motion.svg
                  className="w-5 h-5 text-white/30 flex-shrink-0 ml-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  animate={{ rotate: openFaq === index ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </motion.svg>
              </button>
              <AnimatePresence>
                {openFaq === index && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="px-6 pb-5 text-white/50 leading-relaxed text-sm border-t border-white/[0.05] pt-4">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>

        {filteredFaqs.length === 0 && (
          <div className="text-center py-12 text-white/30">
            {t('helpPage.noResults', { query: searchQuery })}
          </div>
        )}
      </div>

      {/* Contact Section */}
      {SUPPORT_EMAIL && <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8">
        <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-3">{t('helpPage.contactEyebrow')}</p>
        <h2 className="text-2xl font-bold text-white mb-2">{t('helpPage.contactTitle')}</h2>
        <p className="text-white/50 mb-6">
          {t('helpPage.contactSubtitle')}
        </p>

        {submitSuccess ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-6 text-center"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-semibold text-emerald-400 mb-1">{t('helpPage.messageSentTitle')}</h3>
            <p className="text-white/40 text-sm">{t('helpPage.messageSentBody')}</p>
          </motion.div>
        ) : (
          <form onSubmit={handleContactSubmit} className="space-y-4">
            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-white/50 mb-2">
                {t('helpPage.subjectLabel')}
              </label>
              <input
                id="subject"
                type="text"
                required
                value={contactForm.subject}
                onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl focus:outline-none focus:border-violet-500/50 text-white placeholder-white/30 transition-colors"
                placeholder={t('helpPage.subjectPlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-white/50 mb-2">
                {t('helpPage.messageLabel')}
              </label>
              <textarea
                id="message"
                required
                rows={5}
                value={contactForm.message}
                onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl focus:outline-none focus:border-violet-500/50 text-white placeholder-white/30 resize-none transition-colors"
                placeholder={t('helpPage.messagePlaceholder')}
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t('helpPage.submitting') : t('helpPage.submit')}
            </button>
          </form>
        )}

        {/* Contact info */}
        <div className="mt-8 pt-6 border-t border-white/[0.06] flex flex-wrap gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl border border-white/[0.08] bg-white/[0.02] flex items-center justify-center text-white/40">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <div className="text-xs text-white/30">{t('helpPage.emailLabel')}</div>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm font-medium text-white/70 hover:text-white transition-colors">{SUPPORT_EMAIL}</a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl border border-white/[0.08] bg-white/[0.02] flex items-center justify-center text-white/40">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-xs text-white/30">{t('helpPage.responseTimeLabel')}</div>
              <div className="text-sm font-medium text-white/70">{t('helpPage.responseTimeValue')}</div>
            </div>
          </div>
        </div>
      </div>}
    </>
  );

  // If user is logged in, show inside AppShell (dark frame with sidebar)
  if (user) {
    return <AppShell>{mainContent}</AppShell>;
  }

  // Public version — minimal dark frame without sidebar
  return (
    <div className="min-h-screen bg-[#080808] text-white">
      {/* Public header */}
      <header className="border-b border-white/[0.06] sticky top-0 z-50 bg-[#0c0c0c]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate({ to: '/' as any })}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <span className="text-white/40 font-mono text-sm">✦/</span>
            <span className="text-white font-semibold">rankdelta.ai</span>
          </button>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate({ to: '/login' as any })}
              className="text-white/60 hover:text-white font-medium text-sm transition-colors"
            >
              {t('helpPage.signIn')}
            </button>
            <button
              onClick={() => navigate({ to: '/signup' as any })}
              className="px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all"
            >
              {t('helpPage.startFreeTrial')}
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-10">{mainContent}</main>
    </div>
  );
};

export default HelpPage;
