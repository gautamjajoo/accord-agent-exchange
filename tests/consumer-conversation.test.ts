import { describe, expect, it } from 'vitest';
import { buildConsumerIntent } from '../apps/consumers/src/conversation';

describe('consumer follow-up context', () => {
  it('preserves a new request without inventing conversation history', () => {
    expect(buildConsumerIntent('Coffee date', [], '  We prefer somewhere quiet.  ')).toBe('We prefer somewhere quiet.');
  });
  it('keeps useful previous preferences and labels the newest request', () => {
    expect(buildConsumerIntent('Coffee date', ['Near SoMa', 'We like pastries'], 'Under $15')).toBe(
      'Earlier context (excerpt):\nCoffee date\nNear SoMa\nWe like pastries\nLatest request: Under $15',
    );
  });
  it('keeps all 2,000 characters of a permitted latest message instead of rejecting the combined history', () => {
    const latest = 'x'.repeat(2000);
    expect(buildConsumerIntent('Coffee date', ['a'.repeat(2000)], latest)).toBe(latest);
  });
  it('trims old context instead of dropping the end of the latest preference', () => {
    const latest = `${'New preferences '.repeat(80)}must be easy to clean`;
    const result = buildConsumerIntent('Everyday sneakers', ['very old '.repeat(1000), 'Recent preference: all-day comfort'], latest);
    expect(result.length).toBe(2000);
    expect(result).toContain('Recent preference: all-day comfort');
    expect(result.endsWith(`Latest request: ${latest}`)).toBe(true);
    expect(result).not.toContain('Everyday sneakers');
  });
  it('includes only the last three prior messages and ignores blank history', () => {
    const result = buildConsumerIntent('Coffee date', ['obsolete', '', 'one', 'two', 'three'], 'latest');
    expect(result).not.toContain('obsolete');
    expect(result).toContain('Coffee date\none\ntwo\nthree');
  });
  it('bounds repeated follow-ups even when a restored request already includes aggregate history', () => {
    let stored = 'original preference '.repeat(80);
    for (let i = 0; i < 20; i++) {
      const latest = `New preference ${i}: ${'quiet place '.repeat(20)}`.trim();
      stored = buildConsumerIntent('Coffee date', [stored], latest);
      expect(stored.length).toBeLessThanOrEqual(2000);
      expect(stored.endsWith(latest)).toBe(true);
    }
  });
  it('rejects an oversized individual message rather than silently changing the newest request', () => {
    expect(() => buildConsumerIntent('Coffee', [], 'a'.repeat(2001))).toThrow('2,000');
  });
});
