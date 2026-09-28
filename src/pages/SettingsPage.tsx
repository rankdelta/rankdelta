/**
 * Settings Page
 *
 * User settings and preferences
 */

import { useState, useEffect, useRef } from 'react';
import { useLocation } from '@tanstack/react-router';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../hooks/useAuth';
import { getUserNotificationPreferences, saveNotificationPreferences } from '../services/notifications';
import type { NotificationPreferences } from '../services/notifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabaseClient';
import { useTranslation } from 'react-i18next';
import { useSubscription } from '../hooks/useSubscription';
import { useProjects, useDeleteProject, useUpdateProject } from '../hooks/useProjects';
import { useActiveProject } from '../hooks/useActiveProject';
import {
  TrashIcon,
  GlobeAltIcon,
  BanknotesIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';
import { PasswordRequirements } from '../components/auth/PasswordRequirements';
import { isValidPassword } from '../utils/validation';
import { getMoneyPages, suggestMoneyPages, MAX_MONEY_PAGES, type MoneyPage } from '../services/moneyPages';
import { persistSerpKeywords } from '../lib/serpRankPersist';
import { billingEnabled } from '../config/deployment';
import { resolvePlanLabel } from '../config/planPricing';
import { CONTENT_LANGUAGES, normalizeContentLanguage, type ContentLanguage } from '../lib/contentLanguages';
import type { WorkspaceMarket } from '../types/database';
import { WorkspaceMarketSelectOptions } from '../lib/workspaceMarkets';
import { Link } from '@tanstack/react-router';
import {
  HOSTED_MCP_TOOLS,
  createApiKey,
  cursorInstallDeeplink,
  cursorMcpConfigSnippet,
  openCodeMcpConfigSnippet,
  hostedMcpFallbackUrl,
  hostedMcpPrettyUrl,
  hostedMcpUrl,
  listApiKeys,
  revokeApiKey,
  testMcpConnection,
  type ApiKeyRow,
  type McpConnectionTestResult,
} from '../services/apiKeys';

// ─── Dark card wrapper ─────────────────────────────────────────────────────────

function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 mb-5 ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold text-white mb-5">{children}</h2>
}

// ─── Dark input ───────────────────────────────────────────────────────────────

const inputCls =
  'w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm transition-colors'

const inputDisabledCls =
  'w-full px-4 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-white/30 text-sm cursor-not-allowed'

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-violet-600' : 'bg-white/10'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// ─── API keys (hosted MCP) ───────────────────────────────────────────────────

type McpClient = 'claude' | 'cursor' | 'opencode' | 'chatgpt' | 'other';

function McpStepCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 mb-4 last:mb-0">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-200">
          {step}
        </span>
        <h3 className="text-base font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function McpTestConnectionPanel({
  inMemoryKey,
}: {
  inMemoryKey: string | null;
}) {
  const { t } = useTranslation();
  const [pastedKey, setPastedKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<McpConnectionTestResult | null>(null);

  const keyToTest = (inMemoryKey ?? pastedKey).trim();
  const needsPaste = !inMemoryKey;

  const runTest = async () => {
    if (!keyToTest) {
      setResult({ ok: false, message: t('settings.mcpTestNoKey') });
      return;
    }

    setTesting(true);
    setResult(null);
    try {
      const out = await testMcpConnection(keyToTest);
      setResult(out);
    } finally {
      setTesting(false);
    }
  };

  const failureHint =
    result && !result.ok && result.status === 401
      ? t('settings.mcpTestHint401')
      : result && !result.ok
        ? t('settings.mcpTestHintGeneric')
        : null;

  return (
    <div className="mt-5 pt-5 border-t border-white/[0.06] space-y-3">
      {needsPaste && (
        <div>
          <input
            type="password"
            value={pastedKey}
            onChange={(e) => setPastedKey(e.target.value)}
            placeholder={t('settings.mcpTestKeyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            className={inputCls}
          />
          <p className="text-xs text-white/30 mt-1.5">{t('settings.mcpTestKeyHint')}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void runTest()}
        disabled={testing || !keyToTest}
        className="px-5 py-2.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-sm font-medium hover:bg-emerald-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {testing ? t('settings.mcpTesting') : t('settings.mcpTestConnection')}
      </button>

      {result?.ok && (
        <p className="text-sm text-emerald-300 font-medium">
          {t('settings.mcpTestSuccess', { count: result.toolCount })}
        </p>
      )}

      {result && !result.ok && (
        <div className="space-y-1">
          <p className="text-sm text-rose-300 font-medium">
            {t('settings.mcpTestFailed', {
              error: result.status ? `${result.status} ${result.message}` : result.message,
            })}
          </p>
          {failureHint && <p className="text-xs text-white/40">{failureHint}</p>}
        </div>
      )}
    </div>
  );
}

function McpCopyBlock({
  label,
  text,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  label: string;
  text: string;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  onCopy: () => void;
}) {
  return (
    // ph-no-capture: the snippet can embed the freshly created plaintext key.
    <div className="ph-no-capture relative rounded-xl border border-white/[0.08] bg-black/40 p-4 font-mono text-xs text-white/75 whitespace-pre-wrap break-all">
      <div className="text-violet-300/70 mb-2 text-[11px] font-sans font-medium">{label}</div>
      <button
        type="button"
        onClick={onCopy}
        className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[11px] bg-white/10 hover:bg-white/15 text-white/70 font-sans"
      >
        {copied ? copiedLabel : copyLabel}
      </button>
      {text}
    </div>
  );
}

const ApiKeysSection = ({ sectionRef }: { sectionRef?: React.RefObject<HTMLElement | null> }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('Claude / Cursor');
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [client, setClient] = useState<McpClient>('claude');
  const mcpUrl = hostedMcpUrl();
  const prettyUrl = hostedMcpPrettyUrl();
  const keyForSnippet = justCreated ?? 'sk_rankdelta_…';
  const cursorSnippet = cursorMcpConfigSnippet(prettyUrl, keyForSnippet);
  const openCodeSnippet = openCodeMcpConfigSnippet(prettyUrl, keyForSnippet);
  const cursorInstallHref = cursorInstallDeeplink(
    prettyUrl,
    justCreated ?? 'sk_rankdelta_PASTE_KEY_FROM_SETTINGS',
  );
  const bearerBlock = `${prettyUrl}\n\nAuthorization: Bearer ${keyForSnippet}`;

  const { data: keys, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
  });

  const createMut = useMutation({
    mutationFn: () => createApiKey(name.trim() || 'Default'),
    onSuccess: (row) => {
      setJustCreated(row.key);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const active = (keys ?? []).filter((k: ApiKeyRow) => !k.revoked_at);
  const revoked = (keys ?? []).filter((k: ApiKeyRow) => !!k.revoked_at);

  const clientTabs: Array<{ id: McpClient; label: string }> = [
    { id: 'claude', label: t('settings.mcpClientClaude') },
    { id: 'cursor', label: t('settings.mcpClientCursor') },
    { id: 'opencode', label: t('settings.mcpClientOpencode') },
    { id: 'chatgpt', label: t('settings.mcpClientChatgpt') },
    { id: 'other', label: t('settings.mcpClientOther') },
  ];

  const step3Title = t('settings.mcpStep3Title', {
    client: clientTabs.find((c) => c.id === client)?.label ?? client,
  });

  return (
    <Section>
      <section ref={sectionRef} id="api-mcp" className="scroll-mt-24 -mt-6 pt-6">
        <SectionTitle>
          <span className="inline-flex items-center gap-2">
            <KeyIcon className="h-5 w-5 text-violet-400" />
            {t('settings.mcpTitle')}
          </span>
        </SectionTitle>

        <p className="text-sm text-white/50 mb-2">
          {t('settings.mcpIntro')}{' '}
          <Link to="/docs/mcp" className="text-violet-300 hover:underline">
            {t('settings.mcpDocsLink')}
          </Link>
        </p>
        <p className="text-xs text-white/35 mb-5">
          {t('settings.mcpToolsCount', { count: HOSTED_MCP_TOOLS.length })}
        </p>

        <McpStepCard step={1} title={t('settings.mcpStep1Title')}>
          <p className="text-sm text-white/45 mb-4">{t('settings.mcpStep1Hint')}</p>

          {justCreated && (
            // ph-no-capture: keep the plaintext key out of PostHog autocapture ($el_text / attrs).
            <div className="ph-no-capture mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-200 mb-2">{t('settings.mcpCopyKeyNow')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs break-all text-white/90 font-mono">{justCreated}</code>
                <button
                  type="button"
                  onClick={() => copy('key', justCreated)}
                  className="ph-no-capture px-3 py-1.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 shrink-0"
                >
                  {copiedLabel === 'key' ? t('settings.mcpCopied') : t('settings.mcpCopy')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setJustCreated(null)}
                className="mt-3 text-xs text-white/40 hover:text-white/70"
              >
                {t('settings.mcpDismissKey')}
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.mcpKeyNamePlaceholder')}
              className={inputCls}
              maxLength={64}
            />
            <button
              type="button"
              disabled={createMut.isPending}
              onClick={() => createMut.mutate()}
              className="shrink-0 px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {createMut.isPending ? t('settings.mcpCreating') : t('settings.mcpCreateKey')}
            </button>
          </div>
          {createMut.isError && (
            <p className="text-sm text-rose-400 mb-4">
              {(createMut.error as Error)?.message || t('settings.mcpCreateError')}
            </p>
          )}

          {isLoading ? (
            <div className="h-16 bg-white/[0.04] rounded-xl animate-pulse" />
          ) : active.length === 0 ? (
            <p className="text-sm text-white/30">{t('settings.mcpNoActiveKeys')}</p>
          ) : (
            <ul className="space-y-3">
              {active.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-white/80 font-medium truncate">{k.name}</p>
                    <p className="text-xs text-white/35 font-mono mt-0.5">
                      {t('settings.mcpKeyMeta', {
                        prefix: k.key_prefix,
                        date: new Date(k.created_at).toLocaleDateString(),
                        lastUsed: k.last_used_at
                          ? t('settings.mcpLastUsed', {
                              date: new Date(k.last_used_at).toLocaleDateString(),
                            })
                          : '',
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={revokeMut.isPending}
                    onClick={() => {
                      if (confirm(t('settings.mcpRevokeConfirm', { name: k.name }))) {
                        revokeMut.mutate(k.id);
                      }
                    }}
                    className="shrink-0 text-xs text-rose-300/80 hover:text-rose-300 px-3 py-1.5 rounded-full border border-rose-500/20"
                  >
                    {t('settings.mcpRevoke')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {revoked.length > 0 && (
            <p className="mt-4 text-xs text-white/25">
              {t('settings.mcpRevokedHidden', { count: revoked.length })}
            </p>
          )}
        </McpStepCard>

        <McpStepCard step={2} title={t('settings.mcpStep2Title')}>
          <div
            role="tablist"
            aria-label={t('settings.mcpStep2Title')}
            className="flex flex-wrap gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1"
          >
            {clientTabs.map((tab) => {
              const activeTab = client === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab}
                  onClick={() => setClient(tab.id)}
                  className={`flex-1 min-w-[4.5rem] px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </McpStepCard>

        <McpStepCard step={3} title={step3Title}>
          {client === 'claude' && (
            <div className="space-y-3">
              <p className="text-sm text-white/55">{t('settings.mcpClaudeSteps')}</p>
              <McpCopyBlock
                label={t('settings.mcpClaudeBlockLabel')}
                text={prettyUrl}
                copied={copiedLabel === 'claude'}
                copyLabel={t('settings.mcpCopyBlock')}
                copiedLabel={t('settings.mcpCopied')}
                onCopy={() => copy('claude', prettyUrl)}
              />
              <p className="text-xs text-white/35">
                {t('settings.mcpFallback', {
                  url: mcpUrl === prettyUrl ? hostedMcpFallbackUrl() : mcpUrl,
                })}
              </p>
            </div>
          )}

          {client === 'cursor' && (
            <div className="space-y-3">
              <p className="text-sm text-white/55">{t('settings.mcpCursorSteps')}</p>
              {/* ph-no-capture: the deeplink href embeds the plaintext key; autocapture records hrefs. */}
              <a
                href={cursorInstallHref}
                className="ph-no-capture inline-flex items-center gap-2 rounded-xl bg-violet-500/90 hover:bg-violet-400 text-white text-sm font-semibold px-4 py-2.5"
              >
                {t('settings.mcpCursorAddButton')}
              </a>
              <McpCopyBlock
                label={t('settings.mcpCursorBlockLabel')}
                text={cursorSnippet}
                copied={copiedLabel === 'cursor'}
                copyLabel={t('settings.mcpCopyBlock')}
                copiedLabel={t('settings.mcpCopied')}
                onCopy={() => copy('cursor', cursorSnippet)}
              />
            </div>
          )}

          {client === 'opencode' && (
            <div className="space-y-3">
              <p className="text-sm text-white/55">{t('settings.mcpOpencodeSteps')}</p>
              <McpCopyBlock
                label={t('settings.mcpOpencodeBlockLabel')}
                text={openCodeSnippet}
                copied={copiedLabel === 'opencode'}
                copyLabel={t('settings.mcpCopyBlock')}
                copiedLabel={t('settings.mcpCopied')}
                onCopy={() => copy('opencode', openCodeSnippet)}
              />
            </div>
          )}

          {client === 'chatgpt' && (
            <div className="space-y-3">
              <p className="text-sm text-white/55">{t('settings.mcpChatgptSteps')}</p>
              <McpCopyBlock
                label={t('settings.mcpChatgptBlockLabel')}
                text={bearerBlock}
                copied={copiedLabel === 'chatgpt'}
                copyLabel={t('settings.mcpCopyBlock')}
                copiedLabel={t('settings.mcpCopied')}
                onCopy={() => copy('chatgpt', bearerBlock)}
              />
            </div>
          )}

          {client === 'other' && (
            <div className="space-y-3">
              <p className="text-sm text-white/55">{t('settings.mcpOtherSteps')}</p>
              <McpCopyBlock
                label={t('settings.mcpOtherBlockLabel')}
                text={bearerBlock}
                copied={copiedLabel === 'other'}
                copyLabel={t('settings.mcpCopyBlock')}
                copiedLabel={t('settings.mcpCopied')}
                onCopy={() => copy('other', bearerBlock)}
              />
              <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <summary className="cursor-pointer text-sm text-white/60 hover:text-white/80">
                  {t('settings.mcpToolsListToggle', { count: HOSTED_MCP_TOOLS.length })}
                </summary>
                <ul className="mt-3 space-y-2">
                  {HOSTED_MCP_TOOLS.map((tool) => (
                    <li key={tool.name} className="text-xs text-white/50">
                      <code className="text-violet-300/90">{tool.name}</code>
                      <span className="text-white/35"> — {tool.desc}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          <McpTestConnectionPanel inMemoryKey={justCreated} />
        </McpStepCard>
      </section>
    </Section>
  );
};

// ─── Billing section (summary → full page at /billing) ───────────────────────

const BillingSection = () => {
  const { t } = useTranslation();
  const { subscription, currentPlan, isLoading } = useSubscription();

  if (!billingEnabled()) return null;

  const planKey = subscription?.plan ?? 'starter';
  const planLabel = currentPlan
    ? resolvePlanLabel(planKey, currentPlan.display_name)
    : t('billing.noPlan');

  return (
    <Section>
      <SectionTitle>{t('billing.title')}</SectionTitle>
      {isLoading ? (
        <div className="h-16 rounded-xl bg-white/[0.04] animate-pulse" />
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/50">{t('billing.currentPlan')}</p>
            <p className="text-lg font-semibold text-white">{planLabel}</p>
          </div>
          <Link
            to="/billing"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-all"
          >
            {t('usage.viewPlan')}
          </Link>
        </div>
      )}
    </Section>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

// ─── "Pagine chiave" — the money pages every generated article funnels authority to ───

function MoneyPagesSection() {
  const { t } = useTranslation()
  const { data: projects } = useProjects()
  const { activeProjectId } = useActiveProject()
  const updateProject = useUpdateProject()
  const [url, setUrl] = useState('')
  const [kw, setKw] = useState('')
  const [saving, setSaving] = useState(false)

  const project = projects?.find((p) => p.id === activeProjectId) ?? projects?.[0]
  if (!project) return null

  const pages = getMoneyPages(project)
  // One-click candidates from the saved sitemap — a blank URL form is where non-SEO users give up.
  const suggestions = suggestMoneyPages(project, pages, 4)

  // Merge into existing metadata — never clobber sitemap_urls & co.
  const save = async (next: MoneyPage[]) => {
    setSaving(true)
    try {
      await updateProject.mutateAsync({
        id: project.id,
        metadata: { ...((project.metadata as Record<string, unknown>) ?? {}), money_pages: next },
      })
    } catch {
      /* mutation error already surfaces via react-query; list simply stays as-is */
    } finally {
      setSaving(false)
    }
  }

  // Results loop: a money page's commercial keyword is auto-added to rank tracking, so the
  // user SEES the page climb for its keyword (the whole point) without a second manual step.
  const trackKeyword = async (phrase: string) => {
    try {
      await persistSerpKeywords(project.id, [phrase])
    } catch {
      /* best-effort: tracking is a bonus, never block the money-page save */
    }
  }

  const add = () => {
    const u = url.trim()
    const k = kw.trim()
    if (!/^https?:\/\//i.test(u) || !k || pages.length >= MAX_MONEY_PAGES) return
    void save([...pages, { url: u, keyword: k }])
    void trackKeyword(k)
    setUrl('')
    setKw('')
  }

  const remove = (idx: number) => void save(pages.filter((_, i) => i !== idx))

  return (
    <Section>
      <SectionTitle>{t('settings.moneyPagesTitle')}</SectionTitle>
      <p className="text-xs text-white/35 -mt-4 mb-4">{t('settings.moneyPagesHint', { site: project.name })}</p>

      {pages.length > 0 && (
        <div className="space-y-2 mb-4">
          {pages.map((mp, i) => (
            <div key={`${mp.url}-${i}`} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
              <BanknotesIcon className="w-4 h-4 text-emerald-300/70 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white truncate">{mp.url}</div>
                <div className="text-xs text-white/40 truncate">{t('settings.moneyPagesKeywordOf', { keyword: mp.keyword })}</div>
              </div>
              <button
                onClick={() => remove(i)}
                disabled={saving}
                title={t('settings.moneyPagesRemove')}
                className="p-1.5 rounded-lg text-white/30 hover:text-rose-300 hover:bg-white/[0.05] transition-colors disabled:opacity-40"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && pages.length < MAX_MONEY_PAGES && (
        <div className="mb-3">
          <p className="text-xs text-white/35 mb-1.5">{t('settings.moneyPagesSuggested')}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((sug) => (
              <button
                key={sug.url}
                onClick={() => { void save([...pages, sug]); void trackKeyword(sug.keyword) }}
                disabled={saving}
                title={sug.url}
                className="px-2.5 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/[0.06] text-xs text-emerald-200/90 hover:bg-emerald-500/[0.14] transition-colors disabled:opacity-40"
              >
                + {sug.keyword}
              </button>
            ))}
          </div>
        </div>
      )}

      {pages.length < MAX_MONEY_PAGES ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('settings.moneyPagesUrlPlaceholder')}
            className={`${inputCls} sm:flex-[3]`}
          />
          <input
            type="text"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder={t('settings.moneyPagesKeywordPlaceholder')}
            className={`${inputCls} sm:flex-[2]`}
          />
          <button
            onClick={add}
            disabled={saving || !/^https?:\/\//i.test(url.trim()) || !kw.trim()}
            className="px-5 py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors disabled:opacity-40 shrink-0"
          >
            {t('settings.moneyPagesAdd')}
          </button>
        </div>
      ) : (
        <p className="text-xs text-white/35">{t('settings.moneyPagesMaxReached', { max: MAX_MONEY_PAGES })}</p>
      )}
    </Section>
  )
}

// ─── "I tuoi siti" — manage / remove projects ──────────────────────────────────

const siteSelectCls =
  'rounded-lg bg-white/[0.04] border border-white/[0.1] px-2 py-1 text-xs text-white/70 focus:outline-none focus:border-violet-500/50'

function SitesSection() {
  const { t } = useTranslation()
  const { data: projects } = useProjects()
  const { activeProjectId } = useActiveProject()
  const deleteProject = useDeleteProject()
  const updateProject = useUpdateProject()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  if (!projects || projects.length === 0) return null

  // Market + language drive the DataForSEO locale (keyword volume / SERP). Onboarding sets a default,
  // but a site can be mis-assigned (e.g. English content tagged to the IT market → ~0 volume) — these
  // selectors let the user fix it without re-creating the project.
  const setMarket = (id: string, market: WorkspaceMarket) =>
    void updateProject.mutateAsync({ id, market }).catch(() => {})
  const setLanguage = (id: string, lang: ContentLanguage) =>
    void updateProject.mutateAsync({ id, language: lang, primary_language: lang }).catch(() => {})
  // Real author byline (E-E-A-T): used in the article + Article schema `author` when set; otherwise the
  // engine falls back to the brand-team byline. Honest by design — only what the user actually enters.
  const setAuthor = (id: string, author_name: string) =>
    void updateProject.mutateAsync({ id, author_name: author_name.trim() || undefined }).catch(() => {})

  const remove = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteProject.mutateAsync(id)
      // The active project self-heals (useActiveProject falls back to the first remaining site).
    } catch {
      /* surfaced by the disabled state resetting; project stays in the list */
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  return (
    <Section>
      <SectionTitle>{t('settings.sitesTitle')}</SectionTitle>
      <p className="text-xs text-white/35 -mt-4 mb-4">
        {t('settings.sitesDeleteWarning')}
      </p>
      <div className="space-y-2">
        {projects.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
          >
            <GlobeAltIcon className="w-4 h-4 text-white/30 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white truncate">{p.name}</span>
                {p.id === activeProjectId && (
                  <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-200">
                    {t('settings.activeBadge')}
                  </span>
                )}
              </div>
              {p.website_url && <div className="text-xs text-white/40 truncate">{p.website_url}</div>}
              <input
                type="text"
                defaultValue={p.author_name ?? ''}
                onBlur={(e) => { if ((e.target.value.trim() || '') !== (p.author_name ?? '')) setAuthor(p.id, e.target.value) }}
                placeholder={t('settings.authorPlaceholder')}
                aria-label={t('settings.authorAria')}
                className="mt-1.5 w-full max-w-xs rounded-lg bg-white/[0.03] border border-white/[0.08] px-2 py-1 text-xs text-white/70 placeholder-white/25 focus:outline-none focus:border-violet-500/40"
              />
            </div>

            {confirmId !== p.id && (
              <div className="hidden md:flex items-center gap-1.5 shrink-0" title={t('settings.marketLanguageTitle')}>
                <select
                  value={(p.market as string) ?? 'IT'}
                  onChange={(e) => setMarket(p.id, e.target.value as WorkspaceMarket)}
                  className={siteSelectCls}
                  aria-label={t('settings.marketOfAria', { name: p.name })}
                >
                  <WorkspaceMarketSelectOptions t={t} optionClassName="bg-[#111]" />
                </select>
                <select
                  value={(p.primary_language as string) ?? p.language ?? 'it'}
                  onChange={(e) => setLanguage(p.id, normalizeContentLanguage(e.target.value))}
                  className={siteSelectCls}
                  aria-label={t('settings.languageOfAria', { name: p.name })}
                >
                  {CONTENT_LANGUAGES.map((code) => (
                    <option key={code} value={code} className="bg-[#111]">{t(`contentLang.${code}`)}</option>
                  ))}
                </select>
              </div>
            )}

            {confirmId === p.id ? (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-rose-300/90 hidden sm:inline">{t('settings.deleteConfirmPrompt')}</span>
                <button
                  onClick={() => setConfirmId(null)}
                  disabled={deletingId === p.id}
                  className="px-3 py-1.5 rounded-lg border border-white/15 text-white/70 hover:text-white text-xs transition-colors disabled:opacity-50"
                >
                  {t('settings.cancel')}
                </button>
                <button
                  onClick={() => remove(p.id)}
                  disabled={deletingId === p.id}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/90 hover:bg-rose-500 text-white text-xs font-medium transition-colors disabled:opacity-60"
                >
                  {deletingId === p.id ? t('settings.deleting') : t('settings.delete')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmId(p.id)}
                title={t('settings.deleteSiteTitle')}
                aria-label={t('settings.deleteSiteAria', { name: p.name })}
                className="shrink-0 p-2 rounded-lg text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <TrashIcon className="w-4 h-4" strokeWidth={1.8} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Security: change password ─────────────────────────────────────────────────

function ChangePasswordSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (!isValidPassword(next)) {
      setError(t('passwordRules.errorTooWeak'));
      return;
    }
    if (next !== confirm) {
      setError(t('settings.errorPasswordsMismatch'));
      return;
    }
    if (next === current) {
      setError(t('settings.errorSamePassword'));
      return;
    }
    if (!user?.email) {
      setError(t('settings.errorGeneric'));
      return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError(t('settings.errorGeneric'));
        return;
      }

      // Call the GoTrue REST endpoint directly so we can pass `current_password`. Supabase's
      // "Require current password when updating" policy rejects updates that omit it, and the
      // pinned supabase-js (2.84) doesn't expose the field. The server validates it for us, so a
      // wrong current password comes back as an error here.
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: next, current_password: current }),
      });

      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        const code = String(body?.error_code ?? body?.code ?? '');
        const msg = String(body?.msg ?? body?.message ?? body?.error_description ?? '');
        if (/current_password|invalid_credentials/i.test(code) || /current password/i.test(msg)) {
          setError(t('settings.errorCurrentPasswordWrong'));
        } else if (/same_password|should be different|different from/i.test(`${code} ${msg}`)) {
          setError(t('settings.errorSamePassword'));
        } else if (/weak|password/i.test(`${code} ${msg}`)) {
          setError(t('passwordRules.errorTooWeak'));
        } else {
          setError(t('settings.errorGeneric'));
        }
        return;
      }

      // Keep the SDK session in sync after the out-of-band update.
      await supabase.auth.refreshSession().catch(() => {});

      // Revoke every other session (other devices/browsers) — best effort.
      try {
        await supabase.auth.signOut({ scope: 'others' });
      } catch {
        /* ignore */
      }

      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch {
      setError(t('settings.errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section>
      <SectionTitle>{t('settings.securityTitle')}</SectionTitle>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm font-medium text-white/60 mb-1.5">
            {t('settings.currentPassword')}
          </label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            className={inputCls}
            placeholder="••••••••"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/60 mb-1.5">
            {t('settings.newPassword')}
          </label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
            className={inputCls}
            placeholder="••••••••"
          />
          <PasswordRequirements password={next} />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/60 mb-1.5">
            {t('settings.confirmNewPassword')}
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            className={inputCls}
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">
            {error}
          </div>
        )}
        {done && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-sm">
            {t('settings.passwordChanged')}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-full bg-white text-black font-semibold hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm"
        >
          {saving ? t('settings.changingPassword') : t('settings.changePasswordCta')}
        </button>
      </form>
    </Section>
  );
}

// ─── Danger zone: delete account ──────────────────────────────────────────────

const DELETE_CONFIRM_WORD = 'DELETE';

function DeleteAccountDialog({ onClose, signOut }: { onClose: () => void; signOut: () => Promise<void> }) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDelete = confirm.trim() === DELETE_CONFIRM_WORD && !deleting;

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      // Caller is taken from the JWT server-side; cancels Stripe, revokes API keys, deletes the auth
      // user (FK cascades remove projects/content/etc.).
      const { data, error: fnError } = await supabase.functions.invoke<{ ok?: boolean }>('delete-account');
      if (fnError || !data?.ok) {
        console.error('Delete account failed:', fnError?.message ?? 'unexpected response');
        setError(t('settings.deleteAccountError'));
        return;
      }
      // Local cleanup + hard redirect to /login (server-side revoke may 4xx: user is gone — ignored).
      await signOut();
    } catch (err) {
      console.error('Delete account failed:', err instanceof Error ? err.message : err);
      setError(t('settings.deleteAccountError'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-[#0e0e0e] p-6">
        <h3 id="delete-account-title" className="text-lg font-semibold text-white mb-2">
          {t('settings.deleteAccountConfirmTitle')}
        </h3>
        <p className="text-sm text-white/50 mb-4">{t('settings.deleteAccountConfirmBody')}</p>
        <label className="block text-sm font-medium text-white/60 mb-1.5">
          {t('settings.deleteAccountConfirmLabel', { word: DELETE_CONFIRM_WORD })}
        </label>
        <input
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          autoFocus
          className={inputCls}
          placeholder={DELETE_CONFIRM_WORD}
        />
        {error && (
          <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 rounded-full border border-white/20 text-white/70 hover:text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {t('settings.deleteAccountCancel')}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            className="px-4 py-2 rounded-full bg-rose-600 text-white text-sm font-semibold hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? t('settings.deleteAccountDeleting') : t('settings.deleteAccountConfirmCta')}
          </button>
        </div>
      </div>
    </div>
  );
}

export const SettingsPage = () => {
  const { user, signOut } = useAuth();
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const apiMcpSectionRef = useRef<HTMLElement>(null);
  const settingsTab = new URLSearchParams(location.searchStr).get('tab');

  useEffect(() => {
    if (settingsTab !== 'mcp') return undefined;
    const timer = window.setTimeout(() => {
      apiMcpSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [location.searchStr, settingsTab]);

  // Get user preferences
  const { data: preferences } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return null;

      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data || {
        language: 'it',
        theme: 'dark',
        notifications_enabled: true,
        default_content_length: 2000,
      };
    },
  });

  // Get notification preferences
  const { data: notificationPrefs } = useQuery({
    queryKey: ['notification-preferences', user?.id],
    queryFn: () => {
      if (!user) return null;
      return getUserNotificationPreferences(user.id);
    },
    enabled: !!user,
  });

  const updateNotificationPrefs = useMutation({
    mutationFn: async (prefs: NotificationPreferences) => {
      if (!user) throw new Error('Not authenticated');
      await saveNotificationPreferences(user.id, prefs);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });

  const updatePreferences = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('user_preferences')
        .upsert(
          {
            user_id: user.id,
            ...updates,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id',
          }
        )
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-preferences'] });
      setIsUpdating(false);
    },
  });

  const handlePreferenceChange = (key: string, value: unknown) => {
    setIsUpdating(true);
    updatePreferences.mutate({ [key]: value });

    if (key === 'language' && typeof value === 'string') {
      i18n.changeLanguage(value);
      localStorage.setItem('i18nextLng', value);
    }
  };

  return (
    <AppShell maxWidth="5xl">
      {/* Header */}
      <div className="mb-8">
        <p className="text-white/40 text-xs tracking-[0.18em] uppercase">Account</p>
        <h1 className="text-3xl font-bold text-white mt-1.5">{t('settings.title')}</h1>
        <p className="text-white/40 mt-1">{t('settings.subtitle')}</p>
      </div>

      {/* Profile Settings */}
      <Section>
        <SectionTitle>{t('settings.profile')}</SectionTitle>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1.5">{t('settings.email')}</label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className={inputDisabledCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1.5">{t('settings.userId')}</label>
            <input
              type="text"
              value={user?.id || ''}
              disabled
              className={`${inputDisabledCls} font-mono`}
            />
          </div>
        </div>
      </Section>

      {/* Security — change password */}
      <ChangePasswordSection />

      {/* Preferences */}
      {preferences && (
        <Section>
          <SectionTitle>{t('settings.preferences')}</SectionTitle>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-1.5">{t('common.language')}</label>
              <select
                value={preferences.language || 'it'}
                onChange={(e) => handlePreferenceChange('language', e.target.value)}
                className={inputCls}
              >
                <option value="it" className="bg-[#111] text-white">Italiano</option>
                <option value="en" className="bg-[#111] text-white">English</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-white/60 mb-1.5">
                {t('settings.defaultContentLength')}
              </label>
              <input
                type="number"
                value={preferences.default_content_length || 2000}
                onChange={(e) => handlePreferenceChange('default_content_length', parseInt(e.target.value))}
                min="500"
                max="5000"
                step="100"
                className={inputCls}
              />
            </div>
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-white/70">
                  {t('settings.enableNotifications')}
                </p>
                <p className="text-xs text-white/30 mt-0.5">
                  {t('settings.notificationsDescription')}
                </p>
              </div>
              <Toggle
                checked={!!preferences.notifications_enabled}
                onChange={() => handlePreferenceChange('notifications_enabled', !preferences.notifications_enabled)}
              />
            </div>
          </div>
          {isUpdating && (
            <p className="mt-4 text-sm text-violet-400">{t('settings.savingPreferences')}</p>
          )}
        </Section>
      )}

      {/* Notification Preferences */}
      {notificationPrefs && (
        <Section>
          <SectionTitle>{t('settings.notificationPreferences')}</SectionTitle>
          <div className="space-y-4">
            {Object.entries(notificationPrefs).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between py-1 border-b border-white/[0.04] last:border-0">
                <div>
                  <p className="text-sm font-medium text-white/70">
                    {key === 'proposals' && t('settings.proposals')}
                    {key === 'scheduled_content' && t('settings.scheduledContent')}
                    {key === 'ranking_changes' && t('settings.rankingChanges')}
                    {key === 'content_updates' && t('settings.contentUpdates')}
                    {key === 'weekly_report' && t('settings.weeklyReport')}
                  </p>
                  <p className="text-xs text-white/30 mt-0.5">
                    {key === 'proposals' && t('settings.proposalsDescription')}
                    {key === 'scheduled_content' && t('settings.scheduledContentDescription')}
                    {key === 'ranking_changes' && t('settings.rankingChangesDescription')}
                    {key === 'content_updates' && t('settings.contentUpdatesDescription')}
                    {key === 'weekly_report' && t('settings.weeklyReportDescription')}
                  </p>
                </div>
                <Toggle
                  checked={!!value}
                  onChange={() => {
                    updateNotificationPrefs.mutate({
                      ...notificationPrefs,
                      [key]: !value,
                    });
                  }}
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Personal API keys → hosted MCP (Claude / Cursor / Codex) */}
      <ApiKeysSection sectionRef={apiMcpSectionRef} />

      {/* Billing & Subscription */}
      <BillingSection />

      {/* Manage / remove sites */}
      <SitesSection />

      {/* Money pages — the commercial pages the content engine funnels authority to */}
      <MoneyPagesSection />

      {/* Danger Zone */}
      <Section className="border-rose-500/20">
        <SectionTitle>{t('settings.dangerZone')}</SectionTitle>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white/70">{t('settings.deleteAccount')}</p>
              <p className="text-xs text-white/30 mt-0.5">
                {t('settings.deleteAccountDescription')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="px-4 py-2 rounded-full border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-sm font-medium transition-colors"
            >
              {t('settings.deleteAccount')}
            </button>
          </div>
          {deleteOpen && (
            <DeleteAccountDialog onClose={() => setDeleteOpen(false)} signOut={() => signOut()} />
          )}
          <div className="flex items-center justify-between border-t border-white/[0.04] pt-4">
            <div>
              <p className="text-sm font-medium text-white/70">{t('settings.signOut')}</p>
              <p className="text-xs text-white/30 mt-0.5">{t('settings.signOutDescription')}</p>
            </div>
            <button
              onClick={() => signOut()}
              className="px-4 py-2 rounded-full border border-white/20 text-white/70 hover:text-white text-sm font-medium transition-colors"
            >
              {t('settings.signOut')}
            </button>
          </div>
        </div>
      </Section>
    </AppShell>
  );
};
