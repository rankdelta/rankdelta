import { describe, expect, it } from 'vitest';
import { monthStartIso, projectSpendExceeded } from '../../supabase/functions/_shared/projectSpendCap';

describe('monthStartIso', () => {
  it('returns UTC month boundary', () => {
    expect(monthStartIso(new Date('2026-03-15T12:34:56.789Z'))).toBe('2026-03-01T00:00:00.000Z');
    expect(monthStartIso(new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('projectSpendExceeded', () => {
  it('treats null cap as unlimited', () => {
    expect(projectSpendExceeded(10_000, null, 500)).toBe(false);
  });

  it('blocks when cap is zero or negative', () => {
    expect(projectSpendExceeded(0, 0)).toBe(true);
    expect(projectSpendExceeded(0, -1)).toBe(true);
  });

  it('compares month-to-date spend plus estimate against the cap', () => {
    expect(projectSpendExceeded(399, 400, 1)).toBe(false);
    expect(projectSpendExceeded(399, 400, 2)).toBe(true);
    expect(projectSpendExceeded(400, 400, 0)).toBe(false);
    expect(projectSpendExceeded(401, 400, 0)).toBe(true);
  });
});
