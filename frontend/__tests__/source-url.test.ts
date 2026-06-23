import { describe, expect, it } from 'vitest';
import {
  hasTopicUrlPattern,
  renderTopicUrl,
  topicUrlPatternTokens,
} from '@/lib/source-url';

// ─── topicUrlPatternTokens ─────────────────────────────────────────────────

describe('topicUrlPatternTokens', () => {
  it('returns an empty array for an empty string', () => {
    expect(topicUrlPatternTokens('')).toEqual([]);
  });

  it('returns the single token name from a pattern', () => {
    expect(topicUrlPatternTokens('https://example.com/?t={topicNumber}')).toEqual(['topicNumber']);
  });

  it('returns multiple token names in first-seen order', () => {
    expect(topicUrlPatternTokens('{topicNumber}/sol/{solicitationNumber}')).toEqual([
      'topicNumber',
      'solicitationNumber',
    ]);
  });

  it('de-duplicates repeated tokens', () => {
    expect(topicUrlPatternTokens('{x}&other={x}&c={y}')).toEqual(['x', 'y']);
  });

  it('returns empty array for a static pattern (no tokens)', () => {
    expect(topicUrlPatternTokens('https://example.com/topics')).toEqual([]);
  });

  it('handles underscore and digit chars inside token names', () => {
    expect(topicUrlPatternTokens('{baa_id2}')).toEqual(['baa_id2']);
  });
});

// ─── renderTopicUrl ────────────────────────────────────────────────────────

describe('renderTopicUrl', () => {
  it('substitutes {topicNumber} with the provided value', () => {
    const result = renderTopicUrl(
      'https://example.com/?t={topicNumber}',
      { topicNumber: 'AF243-0001' },
    );
    expect(result).toBe('https://example.com/?t=AF243-0001');
  });

  it('substitutes {solicitationNumber} with the provided value', () => {
    const result = renderTopicUrl(
      'https://example.com/?sol={solicitationNumber}',
      { solicitationNumber: 'DoD SBIR 24.4' },
    );
    // spaces → %20
    expect(result).toBe('https://example.com/?sol=DoD%20SBIR%2024.4');
  });

  it('URL-encodes special characters in token values', () => {
    const result = renderTopicUrl(
      'https://example.com/topic/{topicNumber}',
      { topicNumber: 'A/B C&D' },
    );
    expect(result).toBe('https://example.com/topic/A%2FB%20C%26D');
  });

  it('substitutes multiple distinct tokens', () => {
    const pattern = 'https://example.com/sol/{solicitationNumber}/topic/{topicNumber}';
    const result = renderTopicUrl(pattern, {
      topicNumber: 'T001',
      solicitationNumber: 'SOL-99',
    });
    expect(result).toBe('https://example.com/sol/SOL-99/topic/T001');
  });

  it('substitutes a repeated token consistently', () => {
    const result = renderTopicUrl('{topicNumber}?also={topicNumber}', { topicNumber: 'X1' });
    expect(result).toBe('X1?also=X1');
  });

  it('returns empty string for an empty pattern', () => {
    expect(renderTopicUrl('', { topicNumber: 'AF243-0001' })).toBe('');
  });

  it('returns empty string for a whitespace-only pattern', () => {
    expect(renderTopicUrl('   ', { topicNumber: 'AF243-0001' })).toBe('');
  });

  it('returns empty string when a required token is missing (undefined)', () => {
    const result = renderTopicUrl(
      'https://example.com/?t={topicNumber}',
      {},
    );
    expect(result).toBe('');
  });

  it('returns empty string when a required token is explicitly undefined', () => {
    const result = renderTopicUrl(
      'https://example.com/?t={topicNumber}',
      { topicNumber: undefined },
    );
    expect(result).toBe('');
  });

  it('returns empty string when a required token value is blank string', () => {
    const result = renderTopicUrl(
      'https://example.com/?t={topicNumber}',
      { topicNumber: '' },
    );
    expect(result).toBe('');
  });

  it('returns empty string when ANY required token is missing (partial tokens)', () => {
    const result = renderTopicUrl(
      '{topicNumber}/{solicitationNumber}',
      { topicNumber: 'T1' }, // solicitationNumber missing
    );
    expect(result).toBe('');
  });

  it('returns a static pattern verbatim when there are no tokens', () => {
    const staticUrl = 'https://example.com/topics/list';
    expect(renderTopicUrl(staticUrl, {})).toBe(staticUrl);
  });

  it('returns a static pattern verbatim even when extra tokens are supplied', () => {
    const staticUrl = 'https://example.com/topics/list';
    expect(renderTopicUrl(staticUrl, { topicNumber: 'X', solicitationNumber: 'Y' })).toBe(staticUrl);
  });

  it('handles a real DoD SBIRSTTR-style URL', () => {
    const pattern = 'https://www.dodsbirsttr.mil/topics-app/?topicNumber={topicNumber}';
    const result = renderTopicUrl(pattern, { topicNumber: 'AF243-0001' });
    expect(result).toBe(
      'https://www.dodsbirsttr.mil/topics-app/?topicNumber=AF243-0001',
    );
  });
});

// ─── hasTopicUrlPattern ────────────────────────────────────────────────────

describe('hasTopicUrlPattern', () => {
  it('returns false for null', () => {
    expect(hasTopicUrlPattern(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasTopicUrlPattern(undefined)).toBe(false);
  });

  it('returns false when both pattern fields are absent/null', () => {
    expect(hasTopicUrlPattern({})).toBe(false);
    expect(hasTopicUrlPattern({ topicUrlPattern: null })).toBe(false);
    expect(hasTopicUrlPattern({ topic_url_pattern: null })).toBe(false);
  });

  it('returns false for an empty string pattern (camelCase field)', () => {
    expect(hasTopicUrlPattern({ topicUrlPattern: '' })).toBe(false);
  });

  it('returns false for whitespace-only pattern (camelCase field)', () => {
    expect(hasTopicUrlPattern({ topicUrlPattern: '   ' })).toBe(false);
  });

  it('returns false for an empty string pattern (snake_case field)', () => {
    expect(hasTopicUrlPattern({ topic_url_pattern: '' })).toBe(false);
  });

  it('returns false for whitespace-only pattern (snake_case field)', () => {
    expect(hasTopicUrlPattern({ topic_url_pattern: '   ' })).toBe(false);
  });

  it('returns true for a non-empty topicUrlPattern (camelCase — serialized shape)', () => {
    expect(hasTopicUrlPattern({ topicUrlPattern: 'https://example.com/?t={topicNumber}' })).toBe(true);
  });

  it('returns true for a non-empty topic_url_pattern (snake_case — raw DB row shape)', () => {
    expect(hasTopicUrlPattern({ topic_url_pattern: 'https://example.com/?t={topicNumber}' })).toBe(true);
  });

  it('prefers topicUrlPattern over topic_url_pattern when both are present', () => {
    // camelCase is checked first via ??; if it's a valid string, it wins.
    expect(
      hasTopicUrlPattern({
        topicUrlPattern: 'https://a.com',
        topic_url_pattern: '',
      }),
    ).toBe(true);
  });

  it('falls through to topic_url_pattern when topicUrlPattern is null', () => {
    expect(
      hasTopicUrlPattern({
        topicUrlPattern: null,
        topic_url_pattern: 'https://b.com',
      }),
    ).toBe(true);
  });

  it('returns true for a static (no tokens) non-empty pattern', () => {
    expect(hasTopicUrlPattern({ topicUrlPattern: 'https://example.com/topics' })).toBe(true);
  });
});
