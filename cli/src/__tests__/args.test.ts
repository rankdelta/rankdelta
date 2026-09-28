import { describe, it, expect } from 'vitest';
import { parseArgs } from '../args';

describe('parseArgs', () => {
  it('parses a bare command', () => {
    const p = parseArgs(['sites']);
    expect(p.command).toBe('sites');
    expect(p.positionals).toEqual(['sites']);
    expect(p.json).toBe(false);
  });

  it('parses command + positional arg', () => {
    const p = parseArgs(['visibility', 'example.com']);
    expect(p.command).toBe('visibility');
    expect(p.positionals).toEqual(['visibility', 'example.com']);
  });

  it('captures --json', () => {
    const p = parseArgs(['ranks', '--json']);
    expect(p.json).toBe(true);
    expect(p.command).toBe('ranks');
  });

  it('captures --key <value>', () => {
    const p = parseArgs(['sites', '--key', 'sk_rankdelta_abc']);
    expect(p.key).toBe('sk_rankdelta_abc');
    expect(p.positionals).toEqual(['sites']);
  });

  it('captures --key=value form', () => {
    const p = parseArgs(['--key=sk_rankdelta_xyz', 'sites']);
    expect(p.key).toBe('sk_rankdelta_xyz');
    expect(p.command).toBe('sites');
  });

  it('flags --help/-h and --version/-v', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });

  it('treats --key without a value as unknown', () => {
    const p = parseArgs(['sites', '--key']);
    expect(p.key).toBeUndefined();
    expect(p.unknown).toContain('--key');
  });

  it('collects unknown flags', () => {
    const p = parseArgs(['sites', '--nope']);
    expect(p.unknown).toEqual(['--nope']);
  });

  it('treats everything after -- as positional', () => {
    const p = parseArgs(['audit', '--', '--json']);
    expect(p.positionals).toEqual(['audit', '--json']);
    expect(p.json).toBe(false);
  });

  it('returns no command for empty argv', () => {
    const p = parseArgs([]);
    expect(p.command).toBeUndefined();
  });
});
