/**
 * Public docs: how to connect Rankdelta’s hosted MCP to Cursor / Claude / ChatGPT / Grok.
 * Routes: /docs/mcp (en) and /it/docs/mcp (it), no auth. Prose lives in COPY[locale]; the code
 * blocks, URLs, commands and tool names are language-neutral. Keep the tool list in sync with
 * src/services/apiKeys.ts HOSTED_MCP_TOOLS.
 */

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  HOSTED_MCP_TOOLS,
  cursorMcpConfigSnippet,
  cursorInstallDeeplink,
  openCodeMcpConfigSnippet,
  claudeCodeMcpAddCommand,
  hostedMcpFallbackUrl,
  hostedMcpPrettyUrl,
} from '../services/apiKeys';
import { setRobots } from '../lib/seoRobots';

type Locale = 'en' | 'it';

const CANONICALS: Record<Locale, string> = {
  en: 'https://rankdelta.ai/docs/mcp',
  it: 'https://rankdelta.ai/it/docs/mcp',
};

type FaqItem = { q: string; a: string };

type McpCopy = {
  metaTitle: string;
  metaDesc: string;
  eyebrow: string;
  navSettings: string;
  navHome: string;
  h1: string;
  intro: React.ReactNode;
  surfaceTitle: string;
  surfaceBody: string;
  s1Title: string;
  s1Step1: React.ReactNode;
  s1Step2: React.ReactNode;
  s1Step3: string;
  s2Title: string;
  s2Body: React.ReactNode;
  s2Fallback: React.ReactNode;
  s3Title: string;
  cursorBody: React.ReactNode;
  cursorAdd: string;
  cursorPaste: React.ReactNode;
  cursorCloud: React.ReactNode;
  openCodeBody: React.ReactNode;
  openCodeNote: React.ReactNode;
  claudeBody: React.ReactNode;
  claudeSteps: React.ReactNode[];
  claudeWarn: React.ReactNode;
  claudeCodeBody: string;
  claudeCodeNote: React.ReactNode;
  codexBody: React.ReactNode;
  chatgptBody: React.ReactNode;
  chatgptSteps: React.ReactNode[];
  chatgptNote: React.ReactNode;
  s4Title: string;
  s4Caption: React.ReactNode;
  s5Title: string;
  s5Prompts: string[];
  faqTitle: string;
  faq: FaqItem[];
  secTitle: string;
  sec: React.ReactNode[];
  footerHome: string;
  footerAgent: string;
  footerSettings: string;
  footerSignup: string;
  copy: string;
  copied: string;
};

const code = (s: string) => <code className="text-violet-300/90">{s}</code>;

const COPY: Record<Locale, McpCopy> = {
  en: {
    metaTitle: 'Rankdelta MCP — Connect Cursor, Claude & ChatGPT',
    metaDesc:
      'Connect Cursor, Claude, ChatGPT, or Grok to Rankdelta AI SEO software via hosted MCP. Use a personal API key or OAuth so agents can read AI visibility and run research tools on your account.',
    eyebrow: 'Documentation',
    navSettings: 'Settings → API',
    navHome: '← Home',
    h1: 'Connect Rankdelta via MCP',
    intro: (
      <>
        Rankdelta MCP is the hosted Model Context Protocol endpoint for Rankdelta AI SEO software.
        Give ChatGPT, Grok, Claude, or Cursor read access to <strong className="text-white/80">your</strong>{' '}
        AI-visibility data — Share of Voice, who the AI recommends instead of you, and tracked keywords.
        Auth is a personal API key (or OAuth in Claude); every call stays scoped to your account.
      </>
    ),
    surfaceTitle: 'Full hosted tool surface',
    surfaceBody:
      'Agents can read AI-visibility, run capped visibility scans, research keywords, audit pages, pull backlink / domain overviews, track & check ranks, and draft GEO articles — all scoped to your account. Paid tools hit the same monthly API spend cap as the web app, so a looping agent can’t exceed your limit.',
    s1Title: '1. Create an API key',
    s1Step1: (
      <>
        Sign in and open{' '}
        <Link to="/settings" className="text-violet-300 hover:underline">
          Settings → API &amp; MCP
        </Link>
        .
      </>
    ),
    s1Step2: (
      <>
        Click <strong className="text-white/80">Create key</strong>. Copy the {code('sk_rankdelta_…')} value
        once — it won’t be shown again.
      </>
    ),
    s1Step3: 'Revoke anytime from the same page if a key leaks.',
    s2Title: '2. MCP server URL',
    s2Body: (
      <>
        Use the branded URL in any client that supports <strong className="text-white/75">remote MCP</strong>{' '}
        (Streamable HTTP) with a Bearer token:
      </>
    ),
    s2Fallback: <>Fallback (same server): </>,
    s3Title: '3. Connect your client',
    cursorBody: (
      <>
        Fastest path: create a key in Settings, then install with one click (replace the placeholder in the
        prompt, or set {code('RANKDELTA_API_KEY')} and use the committed {code('.cursor/mcp.json')}).
      </>
    ),
    cursorAdd: 'Add to Cursor',
    cursorPaste: (
      <>
        Or paste into {code('~/.cursor/mcp.json')} / project {code('.cursor/mcp.json')}, then restart Cursor:
      </>
    ),
    cursorCloud: (
      <>
        Cloud Agents: also add the same HTTP server under{' '}
        <a className="text-violet-300/80 hover:underline" href="https://cursor.com/agents" target="_blank" rel="noreferrer">
          cursor.com/agents
        </a>{' '}
        → MCP (or Dashboard → Integrations &amp; MCP). Repo <code className="text-white/45">mcp.json</code> alone is not enough for cloud.
      </>
    ),
    openCodeBody: (
      <>
        OpenCode uses a <strong className="text-white/75">different shape than Cursor</strong>: a top-level{' '}
        {code('mcp')} key with {code('type: "remote"')} — not {code('mcpServers')}. Pasting the Cursor snippet is the #1
        reason an OpenCode install silently does nothing. Put this in {code('~/.config/opencode/opencode.json')} (or a
        project {code('opencode.json')}), then restart OpenCode:
      </>
    ),
    openCodeNote: (
      <>
        The key lives in the file on the box (<code className="text-white/45">chmod 600</code>), never in a chat message.
        Make a dedicated key so you can revoke just this one. On older OpenCode builds that ignore remote{' '}
        <code className="text-white/45">headers</code>, run <code className="text-white/45">opencode upgrade</code> first.
      </>
    ),
    claudeBody: (
      <>
        Claude custom connectors only ask for a <strong className="text-white/75">name + URL</strong> (no Bearer field).
        That is expected — auth is OAuth:
      </>
    ),
    claudeSteps: [
      <>Create a key in Settings → API &amp; MCP.</>,
      <>Add custom connector → URL {code('__URL__')} → Continue.</>,
      <>Browser opens Rankdelta authorize → paste {code('sk_rankdelta_…')} → Authorize.</>,
      <>Claude finishes the OAuth callback and tools appear.</>,
    ],
    claudeWarn: (
      <>
        If Claude opens <code className="text-white/45">/authorize?client_id=sk_…</code>, shows raw HTML, or a JSON 405,
        the OAuth authorize page did not load — retry after deploy; revoke any key that appeared in a URL.
      </>
    ),
    claudeCodeBody: 'One command — header auth, no OAuth round-trip:',
    claudeCodeNote: (
      <>
        Same for any Claude Code-based agent. If your build has no <code className="text-white/45">--header</code> flag, use the
        Claude Desktop/Cowork OAuth connector flow above.
      </>
    ),
    codexBody: (
      <>
        Remote MCP with URL + <code className="text-violet-300/90">Authorization: Bearer sk_rankdelta_…</code> (same as Cursor).
      </>
    ),
    chatgptBody: (
      <>
        ChatGPT only allows custom MCP connectors when <strong className="text-white/75">Developer mode</strong> is on — this
        is the step people miss. Turn it on, then add the server; ChatGPT runs an OAuth flow (no Bearer field to paste, same as Claude).
      </>
    ),
    chatgptSteps: [
      <>ChatGPT → <strong className="text-white/75">Settings → Connectors</strong> → enable <strong className="text-white/75">Developer mode</strong> (on Business/Enterprise a workspace admin may need to allow connectors first).</>,
      <>Add a connector with URL {code('__URL__')} → authorize in the browser.</>,
      <>In a chat, open the connector (or use deep research) and ask, e.g. <em>“search my sites, then fetch my AI Share of Voice.”</em></>,
    ],
    chatgptNote: (
      <>
        Deep research and “company knowledge” use the {code('search')} and {code('fetch')} tools; the full tool set is available
        in a normal Developer-mode chat. Grok: use its remote-MCP / Connectors UI with the same URL and OAuth.
      </>
    ),
    s4Title: '4. Available tools (hosted)',
    s4Caption: (
      <>
        Scans are capped (default 6 prompts) to fit Edge timeouts — raise with <code className="text-white/45">max_queries</code> up to 12.
        Multi-page site audits and the full in-app writing pipeline remain richer in the web UI.
      </>
    ),
    s5Title: '5. Try it',
    s5Prompts: [
      '“List my Rankdelta sites.”',
      '“What’s my AI Share of Voice for {site}, and who does ChatGPT recommend instead?”',
      '“Run a visibility scan for {site} (max 6 prompts).”',
      '“Keyword ideas for ‘ai seo tool’ with volume and difficulty.”',
      '“Audit https://example.com/pricing and summarize issues.”',
      '“Backlink summary for rival.com.”',
      '“Track ‘ai seo tool’ for {site}, then check ranks.”',
      '“Draft a GEO article about {topic} targeting {keyword}.”',
    ],
    faqTitle: 'FAQ',
    faq: [
      {
        q: 'What is Rankdelta MCP?',
        a: 'Rankdelta MCP is a hosted Model Context Protocol server for Rankdelta AI SEO software. You connect Cursor, Claude, ChatGPT, or Grok with a personal API key (or OAuth in Claude) so the agent can read your AI-visibility data and run the same research tools as the web app — scoped to your account.',
      },
      {
        q: 'How do I connect Claude to Rankdelta MCP?',
        a: 'Create an API key in Settings → API & MCP, add a Claude custom connector with the Rankdelta MCP URL, then authorize in the browser by pasting the key. Claude does not show a Bearer field; OAuth is expected.',
      },
      {
        q: 'How do I connect Cursor to Rankdelta MCP?',
        a: 'Create a key in Settings, then add the remote MCP URL with Authorization: Bearer sk_rankdelta_… in ~/.cursor/mcp.json or the project .cursor/mcp.json and restart Cursor. Cloud Agents also need the same server under cursor.com/agents → MCP.',
      },
      {
        q: 'How do I connect OpenCode (or a self-hosted agent like Hermes) to Rankdelta MCP?',
        a: 'OpenCode uses a different config shape than Cursor: a top-level "mcp" key with type "remote" (not "mcpServers"). Add rankdelta with the URL https://mcp.rankdelta.ai/mcp and Authorization: Bearer sk_rankdelta_… in ~/.config/opencode/opencode.json, then restart OpenCode. Pasting the Cursor snippet is the most common reason the install appears to do nothing.',
      },
    ],
    secTitle: 'Security & limits',
    sec: [
      <>Never paste your key into a chat prompt. Put it only in the client’s secret / MCP config.</>,
      <>Keys map to your user — agents only see <em>your</em> projects.</>,
      <>Paid MCP tools share the account monthly API hard cap with the web app (fail-closed).</>,
      <>Self-hosted? Your instance serves its own MCP endpoint at <code className="text-white/45">&lt;your Supabase URL&gt;/functions/v1/mcp</code> — see SELF_HOSTING.md in the repo.</>,
    ],
    footerHome: 'Home',
    footerAgent: 'Content Agent',
    footerSettings: 'Open Settings → API',
    footerSignup: 'Create free account',
    copy: 'Copy',
    copied: 'Copied',
  },
  it: {
    metaTitle: 'Rankdelta MCP — Collega Cursor, Claude e ChatGPT',
    metaDesc:
      'Collega Cursor, Claude, ChatGPT o Grok al software SEO AI di Rankdelta via MCP hosted. Usa una API key personale o OAuth così gli agent leggono la tua visibilità AI ed eseguono i tool di ricerca sul tuo account.',
    eyebrow: 'Documentazione',
    navSettings: 'Impostazioni → API',
    navHome: '← Home',
    h1: 'Collega Rankdelta via MCP',
    intro: (
      <>
        Rankdelta MCP è l’endpoint Model Context Protocol hosted del software SEO AI di Rankdelta.
        Dai a ChatGPT, Grok, Claude o Cursor accesso in lettura ai <strong className="text-white/80">tuoi</strong>{' '}
        dati di visibilità AI — Share of Voice, chi l’AI consiglia al posto tuo e le keyword monitorate.
        L’autenticazione è una API key personale (o OAuth in Claude); ogni chiamata resta limitata al tuo account.
      </>
    ),
    surfaceTitle: 'Tutti i tool disponibili (hosted)',
    surfaceBody:
      'Gli agent possono leggere la visibilità AI, lanciare scansioni di visibilità con tetto, fare keyword research, audit di pagine, panoramiche backlink / dominio, tracciare e controllare i ranking e scrivere bozze di articoli GEO — tutto limitato al tuo account. I tool a pagamento usano lo stesso tetto di spesa API mensile della web app, quindi un agent in loop non può superare il tuo limite.',
    s1Title: '1. Crea una API key',
    s1Step1: (
      <>
        Accedi e apri{' '}
        <Link to="/settings" className="text-violet-300 hover:underline">
          Impostazioni → API &amp; MCP
        </Link>
        .
      </>
    ),
    s1Step2: (
      <>
        Clicca <strong className="text-white/80">Crea key</strong>. Copia il valore {code('sk_rankdelta_…')} una
        sola volta — non verrà più mostrato.
      </>
    ),
    s1Step3: 'Puoi revocarla in qualsiasi momento dalla stessa pagina se una key trapela.',
    s2Title: '2. URL del server MCP',
    s2Body: (
      <>
        Usa l’URL con dominio dedicato in qualsiasi client che supporta <strong className="text-white/75">remote MCP</strong>{' '}
        (Streamable HTTP) con un token Bearer:
      </>
    ),
    s2Fallback: <>Fallback (stesso server): </>,
    s3Title: '3. Collega il tuo client',
    cursorBody: (
      <>
        Via più rapida: crea una key nelle Impostazioni, poi installa con un clic (sostituisci il placeholder nel
        prompt, oppure imposta {code('RANKDELTA_API_KEY')} e usa il {code('.cursor/mcp.json')} committato).
      </>
    ),
    cursorAdd: 'Aggiungi a Cursor',
    cursorPaste: (
      <>
        Oppure incolla in {code('~/.cursor/mcp.json')} / nel {code('.cursor/mcp.json')} del progetto, poi riavvia Cursor:
      </>
    ),
    cursorCloud: (
      <>
        Cloud Agents: aggiungi lo stesso server HTTP anche su{' '}
        <a className="text-violet-300/80 hover:underline" href="https://cursor.com/agents" target="_blank" rel="noreferrer">
          cursor.com/agents
        </a>{' '}
        → MCP (o Dashboard → Integrations &amp; MCP). Il solo <code className="text-white/45">mcp.json</code> nel repo non basta per il cloud.
      </>
    ),
    openCodeBody: (
      <>
        OpenCode usa una <strong className="text-white/75">forma diversa da Cursor</strong>: una chiave {code('mcp')} di
        primo livello con {code('type: "remote"')} — non {code('mcpServers')}. Incollare lo snippet di Cursor è il motivo #1
        per cui un’installazione OpenCode non fa nulla in silenzio. Metti questo in {code('~/.config/opencode/opencode.json')} (o
        in un {code('opencode.json')} di progetto), poi riavvia OpenCode:
      </>
    ),
    openCodeNote: (
      <>
        La key vive nel file sulla macchina (<code className="text-white/45">chmod 600</code>), mai in un messaggio di chat.
        Crea una key dedicata così puoi revocare solo quella. Su build vecchie di OpenCode che ignorano gli{' '}
        <code className="text-white/45">headers</code> remoti, esegui prima <code className="text-white/45">opencode upgrade</code>.
      </>
    ),
    claudeBody: (
      <>
        I connettori personalizzati di Claude chiedono solo <strong className="text-white/75">nome + URL</strong> (nessun campo Bearer).
        È previsto — l’autenticazione è OAuth:
      </>
    ),
    claudeSteps: [
      <>Crea una key in Impostazioni → API &amp; MCP.</>,
      <>Aggiungi un connettore personalizzato → URL {code('__URL__')} → Continua.</>,
      <>Il browser apre l’autorizzazione Rankdelta → incolla {code('sk_rankdelta_…')} → Autorizza.</>,
      <>Claude completa il callback OAuth e i tool compaiono.</>,
    ],
    claudeWarn: (
      <>
        Se Claude apre <code className="text-white/45">/authorize?client_id=sk_…</code>, mostra HTML grezzo o un JSON 405,
        la pagina di autorizzazione OAuth non si è caricata — riprova dopo il deploy; revoca ogni key comparsa in un URL.
      </>
    ),
    claudeCodeBody: 'Un solo comando — auth via header, senza giro OAuth:',
    claudeCodeNote: (
      <>
        Vale per qualsiasi agent basato su Claude Code. Se la tua build non ha il flag <code className="text-white/45">--header</code>, usa
        il flusso connettore OAuth di Claude Desktop/Cowork qui sopra.
      </>
    ),
    codexBody: (
      <>
        MCP remoto con URL + <code className="text-violet-300/90">Authorization: Bearer sk_rankdelta_…</code> (come Cursor).
      </>
    ),
    chatgptBody: (
      <>
        ChatGPT consente i connettori MCP personalizzati solo con la <strong className="text-white/75">Developer mode</strong> attiva —
        è il passaggio che tutti saltano. Attivala, poi aggiungi il server; ChatGPT esegue un flusso OAuth (nessun campo Bearer da incollare, come Claude).
      </>
    ),
    chatgptSteps: [
      <>ChatGPT → <strong className="text-white/75">Settings → Connectors</strong> → attiva la <strong className="text-white/75">Developer mode</strong> (su Business/Enterprise un admin del workspace potrebbe dover prima abilitare i connettori).</>,
      <>Aggiungi un connettore con URL {code('__URL__')} → autorizza nel browser.</>,
      <>In una chat, apri il connettore (o usa la deep research) e chiedi, es. <em>“cerca i miei siti, poi recupera la mia AI Share of Voice.”</em></>,
    ],
    chatgptNote: (
      <>
        La deep research e la “company knowledge” usano i tool {code('search')} e {code('fetch')}; l’intero set di tool è disponibile
        in una normale chat in Developer mode. Grok: usa la sua UI remote-MCP / Connectors con lo stesso URL e OAuth.
      </>
    ),
    s4Title: '4. Tool disponibili (hosted)',
    s4Caption: (
      <>
        Le scansioni hanno un tetto (default 6 prompt) per rientrare nei timeout Edge — alzalo con <code className="text-white/45">max_queries</code> fino a 12.
        Gli audit multi-pagina e l’intera pipeline di scrittura in-app restano più ricchi nella web UI.
      </>
    ),
    s5Title: '5. Provalo',
    s5Prompts: [
      '“Elenca i miei siti Rankdelta.”',
      '“Qual è la mia AI Share of Voice per {sito}, e chi consiglia ChatGPT al posto mio?”',
      '“Lancia una scansione di visibilità per {sito} (max 6 prompt).”',
      '“Idee di keyword per ‘tool seo ai’ con volume e difficoltà.”',
      '“Fai l’audit di https://example.com/pricing e riassumi i problemi.”',
      '“Riepilogo backlink per rival.com.”',
      '“Traccia ‘tool seo ai’ per {sito}, poi controlla i ranking.”',
      '“Scrivi la bozza di un articolo GEO su {argomento} mirato a {keyword}.”',
    ],
    faqTitle: 'FAQ',
    faq: [
      {
        q: 'Cos’è Rankdelta MCP?',
        a: 'Rankdelta MCP è un server Model Context Protocol hosted per il software SEO AI di Rankdelta. Colleghi Cursor, Claude, ChatGPT o Grok con una API key personale (o OAuth in Claude) così l’agent legge i tuoi dati di visibilità AI ed esegue gli stessi tool di ricerca della web app — limitati al tuo account.',
      },
      {
        q: 'Come collego Claude a Rankdelta MCP?',
        a: 'Crea una API key in Impostazioni → API & MCP, aggiungi un connettore personalizzato in Claude con l’URL di Rankdelta MCP, poi autorizza nel browser incollando la key. Claude non mostra un campo Bearer; è previsto l’OAuth.',
      },
      {
        q: 'Come collego Cursor a Rankdelta MCP?',
        a: 'Crea una key nelle Impostazioni, poi aggiungi l’URL remote MCP con Authorization: Bearer sk_rankdelta_… in ~/.cursor/mcp.json o nel .cursor/mcp.json del progetto e riavvia Cursor. I Cloud Agents richiedono lo stesso server anche su cursor.com/agents → MCP.',
      },
      {
        q: 'Come collego OpenCode (o un agent self-hosted come Hermes) a Rankdelta MCP?',
        a: 'OpenCode usa una forma di config diversa da Cursor: una chiave "mcp" di primo livello con type "remote" (non "mcpServers"). Aggiungi rankdelta con l’URL https://mcp.rankdelta.ai/mcp e Authorization: Bearer sk_rankdelta_… in ~/.config/opencode/opencode.json, poi riavvia OpenCode. Incollare lo snippet di Cursor è il motivo più comune per cui l’installazione sembra non fare nulla.',
      },
    ],
    secTitle: 'Sicurezza e limiti',
    sec: [
      <>Non incollare mai la key in un prompt di chat. Mettila solo nella config segreta / MCP del client.</>,
      <>Le key sono legate al tuo utente — gli agent vedono solo i <em>tuoi</em> progetti.</>,
      <>I tool MCP a pagamento condividono con la web app il tetto API mensile dell’account (fail-closed).</>,
      <>In self-host? La tua istanza ha il suo endpoint MCP in <code className="text-white/45">&lt;URL del tuo Supabase&gt;/functions/v1/mcp</code> — vedi SELF_HOSTING.md nel repo.</>,
    ],
    footerHome: 'Home',
    footerAgent: 'Content Agent',
    footerSettings: 'Apri Impostazioni → API',
    footerSignup: 'Crea un account gratis',
    copy: 'Copia',
    copied: 'Copiato',
  },
};

/** Italian labels for the hosted tool list (names stay in English; fall back to the EN desc). */
const TOOL_DESC_IT: Record<string, string> = {
  list_sites: 'Elenca i tuoi siti monitorati',
  add_site: 'Registra un nuovo sito cliente (nome + URL), nel limite del tuo piano',
  get_ai_visibility: 'AI Share of Voice (ultimi 30 giorni)',
  list_ai_recommendations: 'Competitor che l’AI consiglia al posto tuo',
  list_engines: 'Motori AI supportati',
  run_visibility_scan: 'Scansione di visibilità AI con tetto (costa crediti)',
  setup_ai_visibility: 'Attivazione visibilità AI in un colpo per un nuovo sito (costa crediti)',
  list_ranks: 'Keyword monitorate + ultima posizione Google salvata',
  track_rank: 'Aggiungi una keyword al Rank Tracker',
  check_ranks: 'Controllo SERP Google fresco per le keyword monitorate (costa crediti)',
  keyword_research: 'Idee di keyword — volume, difficoltà, CPC, intent',
  audit_page: 'Snapshot on-page / tecnico di un URL',
  backlink_summary: 'Riepilogo backlink + domini referenti',
  domain_overview: 'Panoramica traffico organico / keyword',
  generate_article: 'Bozza di articolo orientato GEO (costa crediti)',
};

export function McpDocsPage({ locale = 'en' }: { locale?: Locale }) {
  const c = COPY[locale];
  const canonical = CANONICALS[locale];
  const prettyUrl = hostedMcpPrettyUrl();
  const fallbackUrl = hostedMcpFallbackUrl();
  const [copied, setCopied] = useState<string | null>(null);
  const { i18n } = useTranslation();

  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [locale, i18n]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = c.metaTitle;
    const head = document.head;
    const upsert = (sel: string, make: () => HTMLElement) => {
      let el = head.querySelector(sel);
      if (!el) {
        el = make();
        head.appendChild(el);
      }
      return el;
    };
    const canonicalEl = upsert('link[rel="canonical"]', () => {
      const l = document.createElement('link');
      l.setAttribute('rel', 'canonical');
      return l;
    });
    canonicalEl.setAttribute('href', canonical);
    const alt = (hreflang: string, href: string) => {
      const el = upsert(`link[rel="alternate"][hreflang="${hreflang}"]`, () => {
        const l = document.createElement('link');
        l.setAttribute('rel', 'alternate');
        l.setAttribute('hreflang', hreflang);
        return l;
      });
      el.setAttribute('href', href);
    };
    alt('en', CANONICALS.en);
    alt('it', CANONICALS.it);
    alt('x-default', CANONICALS.en);
    const desc = upsert('meta[name="description"]', () => {
      const m = document.createElement('meta');
      m.setAttribute('name', 'description');
      return m;
    });
    desc.setAttribute('content', c.metaDesc);
    setRobots('index, follow');
    const og = (prop: string, content: string) => {
      const el = upsert(`meta[property="${prop}"]`, () => {
        const m = document.createElement('meta');
        m.setAttribute('property', prop);
        return m;
      });
      el.setAttribute('content', content);
    };
    og('og:title', c.metaTitle);
    og('og:description', c.metaDesc);
    og('og:url', canonical);
    og('og:image', 'https://rankdelta.ai/og-image.png');
    const ld = upsert('script[data-ld="mcp-docs"]', () => {
      const s = document.createElement('script');
      s.setAttribute('type', 'application/ld+json');
      s.setAttribute('data-ld', 'mcp-docs');
      return s;
    });
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle',
          headline: c.metaTitle,
          description: c.metaDesc,
          url: canonical,
          inLanguage: locale === 'it' ? 'it-IT' : 'en-US',
          author: { '@type': 'Organization', name: 'Rankdelta' },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Rankdelta', item: 'https://rankdelta.ai/' },
            { '@type': 'ListItem', position: 2, name: 'MCP', item: canonical },
          ],
        },
        {
          '@type': 'FAQPage',
          mainEntity: c.faq.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        },
      ],
    });
  }, [locale, canonical, c]);

  const copyFn = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const snippet = cursorMcpConfigSnippet(prettyUrl);
  const cursorInstallHref = cursorInstallDeeplink(prettyUrl);
  const openCodeSnippet = openCodeMcpConfigSnippet(prettyUrl);
  const claudeCliCmd = claudeCodeMcpAddCommand(prettyUrl);
  // The __URL__ placeholder in the step copy is replaced with the live URL code element.
  const withUrl = (node: React.ReactNode): React.ReactNode =>
    node === '__URL__' ? code(prettyUrl) : node;

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <header className="sticky top-0 z-50 bg-[#080808]/90 backdrop-blur border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href={locale === 'it' ? '/it' : '/'} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-white/60 font-mono text-sm select-none">✦/</span>
            <span className="text-lg font-semibold tracking-tight text-white">rankdelta.ai</span>
          </a>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/settings" className="text-violet-300 hover:text-violet-200">
              {c.navSettings}
            </Link>
            <a href={locale === 'it' ? '/it' : '/'} className="text-white/50 hover:text-white">
              {c.navHome}
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-14">
        <p className="text-violet-300/80 text-xs tracking-[0.18em] uppercase mb-3">{c.eyebrow}</p>
        <h1 className="text-4xl font-bold text-white mb-3">{c.h1}</h1>
        <p className="text-white/50 text-lg leading-relaxed mb-10">{c.intro}</p>

        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5 mb-10">
          <p className="text-sm font-semibold text-emerald-100 mb-1">{c.surfaceTitle}</p>
          <p className="text-sm text-white/55 leading-relaxed">{c.surfaceBody}</p>
        </div>

        <Section title={c.s1Title}>
          <ol className="list-decimal pl-5 space-y-2 text-white/60 text-sm">
            <li>{c.s1Step1}</li>
            <li>{c.s1Step2}</li>
            <li>{c.s1Step3}</li>
          </ol>
        </Section>

        <Section title={c.s2Title}>
          <p className="text-sm text-white/55 mb-3">{c.s2Body}</p>
          <CodeBlock label="url" text={prettyUrl} copied={copied} copyLabel={c.copy} copiedLabel={c.copied} onCopy={() => copyFn('url', prettyUrl)} />
          <p className="text-xs text-white/35 mt-3">
            {c.s2Fallback}
            <code className="text-white/50">{fallbackUrl}</code>
          </p>
        </Section>

        <Section title={c.s3Title}>
          <h3 className="text-white/85 font-semibold text-sm mb-2">Cursor</h3>
          <p className="text-sm text-white/55 mb-3">{c.cursorBody}</p>
          <a
            href={cursorInstallHref}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-500/90 hover:bg-violet-400 text-white text-sm font-semibold px-4 py-2.5 mb-4"
          >
            {c.cursorAdd}
          </a>
          <p className="text-sm text-white/55 mb-3">{c.cursorPaste}</p>
          <CodeBlock label="cursor" text={snippet} copied={copied} copyLabel={c.copy} copiedLabel={c.copied} onCopy={() => copyFn('cursor', snippet)} />
          <p className="text-xs text-white/35 mt-3">{c.cursorCloud}</p>

          <h3 className="text-white/85 font-semibold text-sm mt-8 mb-2">OpenCode / self-hosted agents (Hermes, OpenClaw)</h3>
          <p className="text-sm text-white/55 mb-2">{c.openCodeBody}</p>
          <CodeBlock label="opencode" text={openCodeSnippet} copied={copied} copyLabel={c.copy} copiedLabel={c.copied} onCopy={() => copyFn('opencode', openCodeSnippet)} />
          <p className="text-xs text-white/35 mt-3">{c.openCodeNote}</p>

          <h3 className="text-white/85 font-semibold text-sm mt-8 mb-2">Claude Cowork / Desktop / claude.ai</h3>
          <p className="text-sm text-white/55 mb-3">{c.claudeBody}</p>
          <ol className="list-decimal pl-5 space-y-2 text-white/60 text-sm mb-3">
            {c.claudeSteps.map((step, i) => (
              <li key={i}>{withUrl(step)}</li>
            ))}
          </ol>
          <p className="text-xs text-white/35 mb-3">{c.claudeWarn}</p>

          <h3 className="text-white/85 font-semibold text-sm mt-8 mb-2">Claude Code (and OpenClaw)</h3>
          <p className="text-sm text-white/55 mb-3">{c.claudeCodeBody}</p>
          <CodeBlock label="claude-code" text={claudeCliCmd} copied={copied} copyLabel={c.copy} copiedLabel={c.copied} onCopy={() => copyFn('claude-code', claudeCliCmd)} />
          <p className="text-xs text-white/35 mt-3">{c.claudeCodeNote}</p>

          <h3 className="text-white/85 font-semibold text-sm mt-8 mb-2">Codex / OpenAI</h3>
          <p className="text-sm text-white/55 mb-3">{c.codexBody}</p>

          <h3 className="text-white/85 font-semibold text-sm mt-8 mb-2">ChatGPT (Plus / Pro / Business / Enterprise)</h3>
          <p className="text-sm text-white/55 mb-3">{c.chatgptBody}</p>
          <ol className="text-sm text-white/55 mb-3 list-decimal ml-5 space-y-1">
            {c.chatgptSteps.map((step, i) => (
              <li key={i}>{withUrl(step)}</li>
            ))}
          </ol>
          <p className="text-sm text-white/45 mb-3">{c.chatgptNote}</p>
        </Section>

        <Section title={c.s4Title}>
          <ul className="space-y-2">
            {HOSTED_MCP_TOOLS.map((t) => (
              <li
                key={t.name}
                className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 rounded-xl border border-white/[0.06] px-4 py-3"
              >
                <code className="text-violet-300 text-sm shrink-0">{t.name}</code>
                <span className="text-sm text-white/50">{locale === 'it' ? TOOL_DESC_IT[t.name] ?? t.desc : t.desc}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-white/35 mt-4">{c.s4Caption}</p>
        </Section>

        <Section title={c.s5Title}>
          <ul className="list-disc pl-5 space-y-2 text-sm text-white/60">
            {c.s5Prompts.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Section>

        <Section title={c.faqTitle}>
          <dl className="space-y-6">
            {c.faq.map((f) => (
              <div key={f.q}>
                <dt className="text-white/90 font-semibold text-sm mb-2">{f.q}</dt>
                <dd className="text-sm text-white/55 leading-relaxed">{f.a}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title={c.secTitle}>
          <ul className="list-disc pl-5 space-y-2 text-sm text-white/60">
            {c.sec.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>

        <div className="mt-12 flex flex-wrap gap-3">
          <a
            href={locale === 'it' ? '/it' : '/'}
            className="px-5 py-2.5 rounded-full border border-white/20 text-white/70 hover:text-white text-sm font-medium"
          >
            {c.footerHome}
          </a>
          <a
            href="/content/new"
            className="px-5 py-2.5 rounded-full border border-white/20 text-white/70 hover:text-white text-sm font-medium"
          >
            {c.footerAgent}
          </a>
          <Link
            to="/settings"
            className="px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-500 text-sm font-medium"
          >
            {c.footerSettings}
          </Link>
          <a
            href={locale === 'it' ? '/it/signup' : '/signup'}
            className="px-5 py-2.5 rounded-full border border-white/20 text-white/70 hover:text-white text-sm font-medium"
          >
            {c.footerSignup}
          </a>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-xl font-bold text-white mb-4">{title}</h2>
      {children}
    </section>
  );
}

function CodeBlock({
  label,
  text,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  label: string;
  text: string;
  copied: string | null;
  copyLabel: string;
  copiedLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="relative rounded-xl border border-white/[0.08] bg-black/40 p-4 font-mono text-xs text-white/75 whitespace-pre-wrap break-all">
      <button
        type="button"
        onClick={onCopy}
        className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[11px] bg-white/10 hover:bg-white/15 text-white/70"
      >
        {copied === label ? copiedLabel : copyLabel}
      </button>
      {text}
    </div>
  );
}
