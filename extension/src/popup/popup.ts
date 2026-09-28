/** Popup entry point: reads the active tab, fetches metrics, renders the card. */

import { normalizeHostname } from '../lib/hostname';
import { callMcpTool, parseBacklinkSummary, parseDomainOverview } from '../lib/mcp';
import { getApiKey } from '../lib/storage';
import type { McpCallOutcome } from '../lib/types';

const content = document.getElementById('content') as HTMLElement;
const domainEl = document.getElementById('domain') as HTMLElement;

/** Tiny typed element factory (keeps us off innerHTML for injected data). */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(target: HTMLElement): void {
  target.replaceChildren();
}

function openOptions(event?: Event): void {
  event?.preventDefault();
  chrome.runtime.openOptionsPage();
}

function fmt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}

/** Read the active tab's hostname using activeTab (granted on the toolbar click). */
async function activeHostname(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return normalizeHostname(tab?.url ?? null);
}

function renderMessage(title: string, body: string, action?: { label: string; onClick: () => void }): void {
  clear(content);
  const wrap = el('div', { className: 'state' }, [
    el('div', { className: 'state-title', textContent: title }),
    el('div', { className: 'state-body', textContent: body }),
  ]);
  if (action) {
    const btn = el('button', { className: 'btn', type: 'button', textContent: action.label });
    btn.addEventListener('click', action.onClick);
    wrap.append(btn);
  }
  content.append(wrap);
}

function renderSkeleton(): void {
  clear(content);
  const card = (): HTMLElement =>
    el('div', { className: 'card' }, [
      el('div', { className: 'skeleton skel-line' }),
      el('div', { className: 'metric-grid skel-grid' }, [
        el('div', { className: 'skeleton skel-metric' }),
        el('div', { className: 'skeleton skel-metric' }),
      ]),
    ]);
  content.append(el('div', { className: 'cards' }, [card(), card()]));
}

interface Metric {
  label: string;
  value: string;
}

function metricCard(title: string, metrics: Metric[]): HTMLElement {
  return el('div', { className: 'card' }, [
    el('p', { className: 'card-title', textContent: title }),
    el(
      'div',
      { className: 'metric-grid' },
      metrics.map((m) =>
        el('div', { className: 'metric' }, [
          el('div', { className: 'metric-value', textContent: m.value }),
          el('div', { className: 'metric-label', textContent: m.label }),
        ]),
      ),
    ),
  ]);
}

function errorCard(title: string, message: string): HTMLElement {
  return el('div', { className: 'card' }, [
    el('p', { className: 'card-title' }, [
      document.createTextNode(`${title}  `),
      el('span', { className: 'badge error', textContent: 'error' }),
    ]),
    el('div', { className: 'state-body', textContent: message }),
  ]);
}

async function run(): Promise<void> {
  document.getElementById('open-options')?.addEventListener('click', openOptions);

  const host = await activeHostname();
  domainEl.textContent = host ?? '';
  domainEl.title = host ?? '';

  const apiKey = await getApiKey();
  if (!apiKey) {
    renderMessage(
      'Connect your Rankdelta key',
      'Add your personal API key (sk_rankdelta_…) to see SEO metrics for the site you are browsing.',
      { label: 'Open settings', onClick: () => openOptions() },
    );
    return;
  }

  if (!host) {
    renderMessage(
      'No domain to analyze',
      'Open a normal website tab (http/https) and reopen this popup to see its SEO metrics.',
    );
    return;
  }

  renderSkeleton();

  const [overview, backlinks] = await Promise.all([
    callMcpTool(apiKey, 'domain_overview', { target: host }),
    callMcpTool(apiKey, 'backlink_summary', { target: host }),
  ]);

  // A 401 on either call means the key itself is bad — surface that above metrics.
  const unauthorized = [overview, backlinks].find(
    (o): o is Extract<McpCallOutcome, { ok: false }> => !o.ok && o.kind === 'unauthorized',
  );
  if (unauthorized) {
    renderMessage('Invalid or expired key', 'Update your Rankdelta API key to continue.', {
      label: 'Update key',
      onClick: () => openOptions(),
    });
    return;
  }

  clear(content);
  const cards = el('div', { className: 'cards' });

  if (overview.ok) {
    const m = parseDomainOverview(overview.data);
    cards.append(
      metricCard('Organic overview', [
        { label: 'Organic traffic / mo', value: fmt(m.organicTraffic) },
        { label: 'Organic keywords', value: fmt(m.organicKeywords) },
      ]),
    );
  } else {
    cards.append(errorCard('Organic overview', overview.message));
  }

  if (backlinks.ok) {
    const m = parseBacklinkSummary(backlinks.data);
    cards.append(
      metricCard('Backlinks', [
        { label: 'Backlinks', value: fmt(m.backlinks) },
        { label: 'Referring domains', value: fmt(m.referringDomains) },
      ]),
    );
  } else {
    cards.append(errorCard('Backlinks', backlinks.message));
  }

  content.append(cards);
}

run().catch(() => {
  renderMessage('Something went wrong', 'Please reopen the popup and try again.');
});
