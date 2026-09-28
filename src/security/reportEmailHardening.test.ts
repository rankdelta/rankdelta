import { describe, expect, it } from 'vitest';

/** Replica of reportEmail.ts esc + branding allowlists (2026-09-12). */
const esc = (s: string): string =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function safeLogoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function safePrimaryColor(raw: string | null | undefined): string {
  if (raw && /^#[0-9A-Fa-f]{3,8}$/.test(raw.trim())) return raw.trim();
  return '#7c3aed';
}

describe('scheduled report email branding', () => {
  it('attribute-escapes quotes so logoUrl cannot break out of src=', () => {
    const injected = 'https://evil.example/x" onerror="alert(1)';
    expect(esc(injected)).toContain('&quot;');
    expect(esc(injected)).not.toContain('" onerror=');
  });

  it('rejects non-https and credentialed logo URLs', () => {
    expect(safeLogoUrl('javascript:alert(1)')).toBeNull();
    expect(safeLogoUrl('http://example.com/logo.png')).toBeNull();
    expect(safeLogoUrl('https://user:pass@example.com/logo.png')).toBeNull();
    expect(safeLogoUrl('https://cdn.example.com/logo.png')).toBe('https://cdn.example.com/logo.png');
  });

  it('only interpolates hex colors into style attributes', () => {
    expect(safePrimaryColor('red;background:url(javascript:alert(1))')).toBe('#7c3aed');
    expect(safePrimaryColor('#7c3aed')).toBe('#7c3aed');
    expect(safePrimaryColor('#fff')).toBe('#fff');
  });
});
