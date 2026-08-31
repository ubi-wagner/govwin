/**
 * THE MENTION PARSER — where a silent failure looks exactly like a success.
 *
 * Both ways of being wrong produce "a comment that saved":
 *   · too eager  — every pasted email address notifies its owner
 *   · too shy    — nobody is notified and the author believes they were heard
 *
 * Neither shows up in a status code, a rendered page, or a database row, so it is tested here
 * against cases written from the failure modes rather than from the implementation.
 */
import { describe, it, expect } from 'vitest';
import { extractMentionTokens, resolveMentions } from '@/lib/projects/mentions';

const ROSTER = [
  { userId: 'u-dana', email: 'dana@acme.test' },
  { userId: 'u-sam', email: 'Sam@Acme.Test' },
  { userId: 'u-noemail', email: null },
];

describe('extractMentionTokens — what counts as a mention', () => {
  it('finds an @address at the start of a comment', () => {
    expect(extractMentionTokens('@dana@acme.test can you look at the rig?')).toEqual(['dana@acme.test']);
  });

  it('finds one mid-sentence, after whitespace', () => {
    expect(extractMentionTokens('asking @dana@acme.test about this')).toEqual(['dana@acme.test']);
  });

  it('DOES NOT match a bare email address in prose', () => {
    // The headline. Without the token-boundary rule, "write to dana@acme.test" notifies Dana —
    // and a person quoting a customer's address in a comment would summon them.
    expect(extractMentionTokens('write to dana@acme.test if it slips')).toEqual([]);
  });

  it('strips trailing sentence punctuation without damaging the address', () => {
    // A dot is legal inside a domain and never at the end of one, so this cannot eat a real TLD.
    expect(extractMentionTokens('over to @dana@acme.test.')).toEqual(['dana@acme.test']);
    expect(extractMentionTokens('(@dana@acme.test),')).toEqual(['dana@acme.test']);
  });

  it('matches inside brackets, which is how people write asides', () => {
    expect(extractMentionTokens('the rig slipped (@sam@acme.test knows why)')).toEqual(['sam@acme.test']);
  });

  it('lowercases and de-duplicates, preserving first-seen order', () => {
    expect(extractMentionTokens('@Sam@Acme.Test and @dana@acme.test and @sam@acme.test'))
      .toEqual(['sam@acme.test', 'dana@acme.test']);
  });

  it('does not match @@ or a bare @', () => {
    expect(extractMentionTokens('@@dana@acme.test')).toEqual([]);
    expect(extractMentionTokens('cost @ 40 hours')).toEqual([]);
  });

  it('does not match a domain with no dot', () => {
    expect(extractMentionTokens('@dana@localhost')).toEqual([]);
  });

  it('survives an empty or absent body rather than throwing', () => {
    expect(extractMentionTokens('')).toEqual([]);
    expect(extractMentionTokens(undefined as unknown as string)).toEqual([]);
  });
});

describe('resolveMentions — against the people who can actually see the project', () => {
  it('resolves a roster member, case-insensitively', () => {
    const r = resolveMentions('@Sam@Acme.Test please confirm', ROSTER, 'u-dana');
    expect(r.userIds).toEqual(['u-sam']);
    expect(r.matched).toEqual(['sam@acme.test']);
  });

  it('leaves somebody NOT on the project unmatched — and still resolves the rest', () => {
    // Not a refusal. A comment rejected over a typo'd name teaches people to stop commenting; and
    // notifying somebody about a project they will be refused is worse than not notifying them.
    const r = resolveMentions('@dana@acme.test @stranger@other.test', ROSTER, 'u-sam');
    expect(r.userIds).toEqual(['u-dana']);
    expect(r.unmatched).toEqual(['stranger@other.test']);
  });

  it('drops the AUTHOR — mentioning yourself is not a notification', () => {
    const r = resolveMentions('@dana@acme.test noting this for myself', ROSTER, 'u-dana');
    expect(r.userIds).toEqual([]);
    expect(r.unmatched, 'and it is not reported as a failed match either').toEqual([]);
  });

  it('counts one person once, however many ways they are spelled', () => {
    const r = resolveMentions('@Sam@Acme.Test @sam@acme.test', ROSTER, 'u-dana');
    expect(r.userIds).toEqual(['u-sam']);
  });

  it('ignores a roster entry with no email rather than matching everything to it', () => {
    const r = resolveMentions('@dana@acme.test', [{ userId: 'u-noemail', email: null }], 'u-x');
    expect(r.userIds).toEqual([]);
    expect(r.unmatched).toEqual(['dana@acme.test']);
  });
});
