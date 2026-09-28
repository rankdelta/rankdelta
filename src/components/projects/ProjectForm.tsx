/**
 * Project Form Component
 *
 * Form for creating and editing projects.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PencilSquareIcon,
  LightBulbIcon,
  SparklesIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { useCreateProject, useUpdateProject, useProject, ProjectLimitError } from '../../hooks/useProjects';
import { useSubscription } from '../../hooks/useSubscription';
import { useUpgradeModal } from '../subscription/UpgradeModal';
import { isValidProjectName, isValidURL, sanitizeString } from '../../utils/validation';
import { analyzeWebsite } from '../../services/websiteAnalysis';
import { inferSiteLocale, urlLanguage } from '../../../supabase/functions/_shared/siteLocale';
import {
  CONTENT_LANGUAGES,
  defaultUiContentLanguage,
  normalizeContentLanguage,
} from '../../lib/contentLanguages';

interface ProjectFormProps {
  projectId?: string;
  onSuccess?: (projectId?: string) => void;
  onCancel?: () => void;
}

const inputCls =
  'w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm transition-colors';

const labelCls = 'block text-sm font-medium text-white/60 mb-1.5';

export const ProjectForm = ({ projectId, onSuccess, onCancel }: ProjectFormProps) => {
  const { t, i18n } = useTranslation();
  // Generate the AI profile in the language the user is reading the UI in (not the site's language).
  const uiLang = defaultUiContentLanguage(i18n.language);
  const { data: existingProject } = useProject(projectId);
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const { checkCanCreateProject } = useSubscription();
  const { openForProjectLimit, UpgradeModal } = useUpgradeModal();

  const [formData, setFormData] = useState({
    name: '',
    website_url: '',
    primary_keyword: '',
    main_topic: '',
    tone: 'professional',
    content_length: 2000,
    language: uiLang as string,
    author_name: '',
    author_bio: '',
    author_expertise: '',
  });

  const [error, setError] = useState<string | null>(null);
  // Picked by hand or detected by "analyze" — otherwise the site's URL decides (then the UI language).
  const [languageChosen, setLanguageChosen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [audience, setAudience] = useState<string[]>([]);

  // "Generate with AI": read the site and pre-fill the profile (the user reviews/edits before saving).
  const handleAnalyze = async () => {
    if (!formData.website_url || !isValidURL(formData.website_url)) {
      setError(t('projectForm.errorInvalidUrl'));
      return;
    }
    setError(null);
    setAnalyzing(true);
    try {
      const p = await analyzeWebsite(formData.website_url, uiLang);
      setFormData((prev) => ({
        ...prev,
        name: prev.name || p.brandName,
        primary_keyword: p.primaryKeyword || prev.primary_keyword,
        main_topic: p.mainTopic || prev.main_topic,
        language: normalizeContentLanguage(p.language || prev.language),
        author_expertise: p.expertise || prev.author_expertise,
        author_bio: p.description || prev.author_bio,
        author_name: prev.author_name || (p.brandName ? t('projectForm.authorNameDefault', { brand: p.brandName }) : prev.author_name),
      }));
      setAudience(p.targetAudience);
      if (p.language) setLanguageChosen(true);
      setAnalyzed(true);
    } catch {
      setError(t('projectForm.errorAnalyzeFailed'));
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (existingProject) {
      setFormData({
        name: existingProject.name || '',
        website_url: existingProject.website_url || '',
        primary_keyword: existingProject.primary_keyword || '',
        main_topic: existingProject.main_topic || '',
        tone: existingProject.tone || 'professional',
        content_length: existingProject.content_length || 2000,
        language: existingProject.language || 'en',
        author_name: existingProject.author_name || '',
        author_bio: existingProject.author_bio || '',
        author_expertise: existingProject.author_expertise || '',
      });
    }
  }, [existingProject]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const sanitizedName = sanitizeString(formData.name);
    if (!isValidProjectName(sanitizedName)) {
      setError(t('projectForm.errorInvalidName'));
      setIsSubmitting(false);
      return;
    }

    if (formData.website_url && !isValidURL(formData.website_url)) {
      setError(t('projectForm.errorInvalidUrlSubmit'));
      setIsSubmitting(false);
      return;
    }

    try {
      if (!projectId) {
        const gate = await checkCanCreateProject();
        if (!gate.canCreate) {
          openForProjectLimit();
          setIsSubmitting(false);
          return;
        }
      }

      const sanitizedData = {
        ...formData,
        name: sanitizedName,
        website_url: formData.website_url ? sanitizeString(formData.website_url) : undefined,
        primary_keyword: formData.primary_keyword ? sanitizeString(formData.primary_keyword) : undefined,
        main_topic: formData.main_topic ? sanitizeString(formData.main_topic) : undefined,
        author_name: formData.author_name ? sanitizeString(formData.author_name) : undefined,
        author_bio: formData.author_bio ? sanitizeString(formData.author_bio) : undefined,
        author_expertise: formData.author_expertise ? sanitizeString(formData.author_expertise) : undefined,
      };

      if (projectId) {
        await updateProject.mutateAsync({ id: projectId, ...sanitizedData });
        onSuccess?.(projectId);
      } else {
        // Never fall back to the DB column defaults: derive language + market from the site.
        const siteLocale = inferSiteLocale({
          url: sanitizedData.website_url ?? '',
          language: languageChosen ? sanitizedData.language : (urlLanguage(sanitizedData.website_url ?? '') ?? sanitizedData.language),
        });
        const newProject = await createProject.mutateAsync({
          ...sanitizedData,
          language: siteLocale.language,
          primary_language: siteLocale.language,
          market: siteLocale.market,
        });

        if (newProject.primary_keyword) {
          void import('../../services/proposalAutoGeneration').then(({ startAutomaticProposalGeneration }) => {
            void startAutomaticProposalGeneration(newProject).catch((error) => {
              console.error('Error starting automatic proposal generation:', error);
            });
          });
        }

        // First result without effort: auto-run the (cheap ~$0.03) guided audit in the background so
        // the Comando shows "Salute del sito" by the time the user gets there. Fire-and-forget — never
        // blocks navigation, never throws. (The visibility check stays one-click, per cost policy.)
        if (newProject.website_url) {
          const pid = newProject.id;
          void import('../../services/auditStatus').then(({ markAuditRunning }) => markAuditRunning(pid));
          void (async () => {
            try {
              const [{ runGuidedAudit }, { saveSiteAudit }] = await Promise.all([
                import('../../services/agent/guidedAudit'),
                import('../../services/siteAudit'),
              ]);
              const result = await runGuidedAudit({
                siteUrl: newProject.website_url as string,
                language: (newProject.language as string) || 'en',
                uiLanguage: i18n.language,
              });
              await saveSiteAudit(pid, result);
            } catch (err) {
              console.warn('[Onboarding] auto-audit skipped:', err);
            } finally {
              void import('../../services/auditStatus').then(({ clearAuditRunning }) => clearAuditRunning(pid));
            }
          })();
        }

        onSuccess?.(newProject.id);
      }
    } catch (err) {
      if (err instanceof ProjectLimitError) {
        openForProjectLimit();
      } else {
        setError(t('projectForm.errorSave'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectCls = inputCls + ' bg-white/[0.03]';

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="name" className={labelCls}>
          {t('projectForm.nameLabel')} *
        </label>
        <input
          id="name"
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
          className={inputCls}
          placeholder={t('projectForm.namePlaceholder')}
        />
      </div>

      <div>
        <label htmlFor="website_url" className={labelCls}>
          {t('projectForm.urlLabel')}
        </label>
        <input
          id="website_url"
          type="url"
          maxLength={500}
          value={formData.website_url}
          onChange={(e) => setFormData({ ...formData, website_url: e.target.value })}
          className={inputCls}
          placeholder="https://example.com"
        />
        {!projectId && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing || !formData.website_url}
              className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200 px-3.5 py-1.5 text-xs font-medium hover:bg-violet-500/25 transition-colors disabled:opacity-50"
            >
              <SparklesIcon className={`w-3.5 h-3.5 ${analyzing ? 'animate-pulse' : ''}`} strokeWidth={1.8} />
              {analyzing ? t('projectForm.analyzeAnalyzing') : t('projectForm.analyzeCta')}
            </button>
            {analyzed && !analyzing && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                <CheckCircleIcon className="w-3.5 h-3.5" /> {t('projectForm.analyzePrefilled')}
              </span>
            )}
            {!analyzed && !analyzing && (
              <span className="text-xs text-white/35">{t('projectForm.analyzeHint')}</span>
            )}
          </div>
        )}
      </div>

      {audience.length > 0 && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
          <p className="text-xs text-white/40 mb-2">{t('projectForm.audienceDetected')}</p>
          <div className="flex flex-wrap gap-1.5">
            {audience.map((a) => (
              <span key={a} className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.04] text-white/70">
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="primary_keyword" className={labelCls}>
            {t('projectForm.keywordLabel')}
          </label>
          <input
            id="primary_keyword"
            type="text"
            maxLength={255}
            value={formData.primary_keyword}
            onChange={(e) => setFormData({ ...formData, primary_keyword: e.target.value })}
            className={inputCls}
            placeholder={t('projectForm.keywordPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="main_topic" className={labelCls}>
            {t('projectForm.topicLabel')}
          </label>
          <input
            id="main_topic"
            type="text"
            maxLength={255}
            value={formData.main_topic}
            onChange={(e) => setFormData({ ...formData, main_topic: e.target.value })}
            className={inputCls}
            placeholder={t('projectForm.topicPlaceholder')}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="tone" className={labelCls}>
            {t('projectForm.toneLabel')}
          </label>
          <select
            id="tone"
            value={formData.tone}
            onChange={(e) => setFormData({ ...formData, tone: e.target.value })}
            className={selectCls}
          >
            <option value="professional">{t('projectForm.toneProfessional')}</option>
            <option value="conversational">{t('projectForm.toneConversational')}</option>
            <option value="technical">{t('projectForm.toneTechnical')}</option>
            <option value="beginner">{t('projectForm.toneBeginner')}</option>
          </select>
        </div>

        <div>
          <label htmlFor="language" className={labelCls}>
            {t('projectForm.languageLabel')}
          </label>
          <select
            id="language"
            value={formData.language}
            onChange={(e) => {
              setLanguageChosen(true);
              setFormData({ ...formData, language: normalizeContentLanguage(e.target.value) });
            }}
            className={selectCls}
          >
            {CONTENT_LANGUAGES.map((code) => (
              <option key={code} value={code}>{t(`contentLang.${code}`)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Author Profile Section */}
      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <PencilSquareIcon className="w-5 h-5 text-violet-300" strokeWidth={1.8} />
          <h3 className="text-base font-semibold text-white">{t('projectForm.authorSectionTitle')}</h3>
          <span className="text-xs text-white/40 bg-white/[0.06] px-2 py-0.5 rounded-full">E-E-A-T &amp; GEO</span>
        </div>
        <p className="text-sm text-white/50 mb-4">
          {t('projectForm.authorSectionDesc')}
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="author_name" className={labelCls}>
              {t('projectForm.authorNameLabel')}
            </label>
            <input
              id="author_name"
              type="text"
              value={formData.author_name}
              onChange={(e) => setFormData({ ...formData, author_name: e.target.value })}
              className={inputCls}
              placeholder={t('projectForm.authorNamePlaceholder')}
            />
          </div>

          <div>
            <label htmlFor="author_expertise" className={labelCls}>
              {t('projectForm.authorExpertiseLabel')}
              <span className="text-xs text-white/25 ml-2">{t('projectForm.authorExpertiseHint')}</span>
            </label>
            <input
              id="author_expertise"
              type="text"
              value={formData.author_expertise}
              onChange={(e) => setFormData({ ...formData, author_expertise: e.target.value })}
              className={inputCls}
              placeholder={t('projectForm.authorExpertisePlaceholder')}
            />
            <p className="text-xs text-white/25 mt-1 flex items-center gap-1">
              <LightBulbIcon className="w-3.5 h-3.5" strokeWidth={2} />
              {t('projectForm.authorExpertiseTip')}
            </p>
          </div>

          <div>
            <label htmlFor="author_bio" className={labelCls}>
              {t('projectForm.authorBioLabel')}
              <span className="text-xs text-white/25 ml-2">{t('projectForm.authorBioHint')}</span>
            </label>
            <textarea
              id="author_bio"
              value={formData.author_bio}
              onChange={(e) => setFormData({ ...formData, author_bio: e.target.value })}
              rows={3}
              className={inputCls + ' resize-none'}
              placeholder={t('projectForm.authorBioPlaceholder')}
            />
            <p className="text-xs text-white/25 mt-1 flex items-center gap-1">
              <LightBulbIcon className="w-3.5 h-3.5" strokeWidth={2} />
              {t('projectForm.authorBioTip')}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              {t('projectForm.saving')}
            </span>
          ) : projectId ? t('projectForm.update') : t('projectForm.create')}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 rounded-full border border-white/[0.15] text-white/70 font-semibold hover:bg-white/[0.05] transition-colors"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </form>
    <UpgradeModal />
  </>
  );
};
