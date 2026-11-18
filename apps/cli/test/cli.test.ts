import { describe, expect, it } from 'vitest';
import { EXIT_OK, EXIT_USAGE, runCli } from '../src/index.ts';

function run(...argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = runCli(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t) }, '9.8.7');
  return { code, out, err };
}

describe('daybird', () => {
  it('prints help with no arguments and with --help', () => {
    for (const args of [[], ['--help'], ['-h']]) {
      const r = run(...args);
      expect(r.code).toBe(EXIT_OK);
      expect(r.out).toContain('Usage: daybird');
      expect(r.err).toBe('');
    }
  });

  it('prints the version', () => {
    expect(run('--version')).toEqual({ code: EXIT_OK, out: '9.8.7\n', err: '' });
    expect(run('-V').out).toBe('9.8.7\n');
  });

  it('refuses what it does not know, with the help on stdout', () => {
    const r = run('export');
    expect(r.code).toBe(EXIT_USAGE);
    expect(r.err).toContain("unknown command 'export'");
    expect(r.out).toContain('Usage: daybird');
    expect(run('--nope').err).toContain("unknown option '--nope'");
  });
});
