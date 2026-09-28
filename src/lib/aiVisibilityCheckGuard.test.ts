import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_SECRET_HEADER,
  INVALID_REQUEST,
  MIN_FORM_MS,
  PROGRAMMATIC_IP_MAX_PER_HOUR,
  WIDGET_IP_MAX_PER_HOUR,
  guardPublicCheckBots,
  isTrustedIntegration,
  shouldBlockOnEmailCap,
  shouldBlockOnIpCap,
  wantsResultEmail,
} from '../../supabase/functions/ai-visibility-check/request_guard';

const NOW = 1_778_000_000_000;
const integrationBody = {
  domain: 'example-integration.com',
  email: 'integration@example.com',
  lang: 'en',
};

describe('guardPublicCheckBots — server-to-server integration contract', () => {
  it('accepts {domain, email, lang} with no formStartedAt', () => {
    const g = guardPublicCheckBots(integrationBody, NOW);
    expect(g).toEqual({ ok: true, programmatic: true });
  });

  it('accepts the same body when website is omitted or empty', () => {
    expect(guardPublicCheckBots({ ...integrationBody, website: '' }, NOW).ok).toBe(true);
    expect(guardPublicCheckBots({ ...integrationBody, website: undefined }, NOW).ok).toBe(true);
  });

  it('treats an untrusted request without formStartedAt as a widget request (rejected)', () => {
    const g = guardPublicCheckBots(integrationBody, NOW, false);
    expect(g).toEqual({ ok: false, status: 400, body: INVALID_REQUEST });
  });

  it('applies the widget timing check to an untrusted request that sends formStartedAt', () => {
    expect(guardPublicCheckBots({ ...integrationBody, formStartedAt: NOW - MIN_FORM_MS }, NOW, false))
      .toEqual({ ok: true, programmatic: false });
    expect(guardPublicCheckBots({ ...integrationBody, formStartedAt: NOW - 10 }, NOW, false))
      .toEqual({ ok: false, status: 400, body: INVALID_REQUEST });
  });
});

describe('isTrustedIntegration', () => {
  it('uses the header name x-rankdelta-integration-secret', () => {
    expect(INTEGRATION_SECRET_HEADER).toBe('x-rankdelta-integration-secret');
  });

  it('keeps the unauthenticated contract when CHECK_INTEGRATION_SECRET is not set', () => {
    expect(isTrustedIntegration(undefined, null)).toBe(true);
    expect(isTrustedIntegration(null, undefined)).toBe(true);
    expect(isTrustedIntegration('', 'anything')).toBe(true);
    expect(isTrustedIntegration('   ', null)).toBe(true);
  });

  it('requires a matching header when CHECK_INTEGRATION_SECRET is set', () => {
    const secret = 'integration-secret-0123456789';
    expect(isTrustedIntegration(secret, secret)).toBe(true);
    expect(isTrustedIntegration(secret, null)).toBe(false);
    expect(isTrustedIntegration(secret, undefined)).toBe(false);
    expect(isTrustedIntegration(secret, '')).toBe(false);
    expect(isTrustedIntegration(secret, 'integration-secret-0123456788')).toBe(false);
    expect(isTrustedIntegration(secret, `${secret}x`)).toBe(false);
  });

  it('combined with the guard: wrong secret + no formStartedAt is rejected, right secret is programmatic', () => {
    const secret = 'integration-secret-0123456789';
    expect(guardPublicCheckBots(integrationBody, NOW, isTrustedIntegration(secret, 'nope')).ok).toBe(false);
    expect(guardPublicCheckBots(integrationBody, NOW, isTrustedIntegration(secret, secret)))
      .toEqual({ ok: true, programmatic: true });
  });
});

describe('guardPublicCheckBots — landing widget', () => {
  it('rejects a filled honeypot with the same generic invalid_request', () => {
    const g = guardPublicCheckBots({ ...integrationBody, website: 'https://spam.test' }, NOW);
    expect(g).toEqual({ ok: false, status: 400, body: INVALID_REQUEST });
  });

  it('rejects instant widget submits (formStartedAt too recent)', () => {
    const g = guardPublicCheckBots(
      { ...integrationBody, formStartedAt: NOW - (MIN_FORM_MS - 1) },
      NOW,
    );
    expect(g).toEqual({ ok: false, status: 400, body: INVALID_REQUEST });
  });

  it('rejects missing-but-present-as-zero formStartedAt (the old bug for omitted fields used Number(?? 0))', () => {
    const g = guardPublicCheckBots({ ...integrationBody, formStartedAt: 0 }, NOW);
    expect(g).toEqual({ ok: false, status: 400, body: INVALID_REQUEST });
  });

  it('accepts a widget submit after the min dwell time', () => {
    const g = guardPublicCheckBots(
      { ...integrationBody, website: '', formStartedAt: NOW - MIN_FORM_MS },
      NOW,
    );
    expect(g).toEqual({ ok: true, programmatic: false });
  });
});

describe('shouldBlockOnIpCap', () => {
  it('blocks the landing widget at 5 checks/hour from one IP', () => {
    expect(shouldBlockOnIpCap(false, WIDGET_IP_MAX_PER_HOUR - 1)).toBe(false);
    expect(shouldBlockOnIpCap(false, WIDGET_IP_MAX_PER_HOUR)).toBe(true);
    expect(shouldBlockOnIpCap(false, WIDGET_IP_MAX_PER_HOUR + 10)).toBe(true);
  });

  it('does not 429 programmatic integrations at the widget 5/h cap', () => {
    expect(shouldBlockOnIpCap(true, WIDGET_IP_MAX_PER_HOUR)).toBe(false);
    expect(shouldBlockOnIpCap(true, WIDGET_IP_MAX_PER_HOUR + 2)).toBe(false);
  });

  it('still caps programmatic traffic from one IP', () => {
    expect(shouldBlockOnIpCap(true, PROGRAMMATIC_IP_MAX_PER_HOUR - 1)).toBe(false);
    expect(shouldBlockOnIpCap(true, PROGRAMMATIC_IP_MAX_PER_HOUR)).toBe(true);
  });
});

describe('shouldBlockOnEmailCap', () => {
  it('blocks the landing widget when the recipient or global cap is hit', () => {
    expect(shouldBlockOnEmailCap(false, true, false)).toBe(true);
    expect(shouldBlockOnEmailCap(false, false, true)).toBe(true);
  });

  it('does not block programmatic one-offs — they still get the JSON payload', () => {
    expect(shouldBlockOnEmailCap(true, true, true)).toBe(false);
    expect(shouldBlockOnEmailCap(true, false, false)).toBe(false);
  });
});

// Only a visitor who typed their own address gets the result email by default; integrations
// must opt in.
describe('wantsResultEmail', () => {
  it('always emails a widget visitor', () => {
    expect(wantsResultEmail(false, { domain: 'a.com', email: 'me@a.com' })).toBe(true);
  });

  it('does not email on behalf of programmatic callers by default', () => {
    expect(wantsResultEmail(true, integrationBody)).toBe(false);
    expect(wantsResultEmail(true, { ...integrationBody, sendEmail: 'true' })).toBe(false);
    expect(wantsResultEmail(true, null)).toBe(false);
  });

  it('lets a programmatic caller opt in explicitly', () => {
    expect(wantsResultEmail(true, { ...integrationBody, sendEmail: true })).toBe(true);
  });
});
