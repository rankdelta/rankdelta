import { describe, expect, it } from 'vitest';
import { csvCell, escapeHtml } from './export';

describe('csvCell', () => {
  it('wraps values in quotes and doubles inner quotes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(12)).toBe('"12"');
  });

  it('neutralises leading formula characters', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('+cmd')).toBe('"\'+cmd"');
    expect(csvCell('-2')).toBe('"\'-2"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
  });

  it('leaves non-formula text alone', () => {
    expect(csvCell('keyword with = inside')).toBe('"keyword with = inside"');
  });
});

describe('escapeHtml', () => {
  it('escapes markup-significant characters', () => {
    expect(escapeHtml('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  });
});
