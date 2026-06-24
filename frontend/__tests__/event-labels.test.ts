/**
 * Canonical event-label map — the single source of truth for the activity
 * stream, notification bell, notifications API, dashboard, and proposal
 * timeline. Guards against the regression where consumers keyed on
 * `${namespace}.${type}` (double-prefix) and rendered raw strings.
 */
import { describe, it, expect } from 'vitest';
import { describeEvent, eventHref, isNotifyWorthyPhase } from '@/lib/event-labels';

describe('describeEvent', () => {
  it('labels proposal.advanced from the real payload field (targetStage, :end)', () => {
    expect(
      describeEvent({ namespace: 'proposal', type: 'proposal.advanced', phase: 'end', payload: { targetStage: 'review' } }),
    ).toBe('Proposal advanced to review');
  });

  it('labels common customer events without the namespace double-prefix', () => {
    expect(describeEvent({ namespace: 'library', type: 'file.uploaded', phase: 'single' })).toBe('File uploaded to library');
    expect(describeEvent({ namespace: 'proposal', type: 'comment.created', phase: 'single' })).toBe('Comment added');
    expect(describeEvent({ namespace: 'capture', type: 'topic.pinned', phase: 'single' })).toBe('Opportunity pinned');
    const saved = describeEvent({ namespace: 'proposal', type: 'section.saved', phase: 'single', payload: { title: 'Technical Volume' } });
    expect(saved).toBe('Section saved: Technical Volume');
  });

  it('never returns the broken ${namespace}.${type} double-prefix', () => {
    const label = describeEvent({ namespace: 'proposal', type: 'proposal.created', phase: 'end', payload: {} });
    expect(label).not.toContain('proposal.proposal');
    expect(label.toLowerCase()).toContain('proposal created');
  });

  it('humanizes unknown types instead of dumping raw strings', () => {
    expect(describeEvent({ namespace: 'proposal', type: 'widget.frobnicated', phase: 'single' })).toBe('Widget frobnicated');
  });

  it('handles tool + system closed-loop events', () => {
    expect(describeEvent({ namespace: 'tool', type: 'proposal.draft_section', phase: 'start' })).toMatch(/AI tool started/);
    expect(
      describeEvent({ namespace: 'system', type: 'email.invite_delivered', phase: 'single', payload: { status: 'sent', recipientEmail: 'a@b.com' } }),
    ).toBe('Invite email sent to a@b.com');
  });
});

describe('eventHref', () => {
  const slug = 'acme';
  it('links proposal events to the workspace, section events to the section', () => {
    expect(eventHref(slug, { namespace: 'proposal', type: 'proposal.advanced', payload: { proposalId: 'p1' } })).toBe('/portal/acme/proposals/p1');
    expect(eventHref(slug, { namespace: 'proposal', type: 'section.saved', payload: { proposalId: 'p1', sectionId: 's1' } })).toBe('/portal/acme/proposals/p1/sections/s1');
  });
  it('links library + opportunity + profile events to their surfaces', () => {
    expect(eventHref(slug, { namespace: 'library', type: 'file.uploaded', payload: {} })).toBe('/portal/acme/library');
    expect(eventHref(slug, { namespace: 'capture', type: 'topic.pinned', payload: { opportunityId: 'o1' } })).toBe('/portal/acme/spotlights/o1');
    expect(eventHref(slug, { namespace: 'capture', type: 'profile.updated', payload: {} })).toBe('/portal/acme/profile');
  });
  it('returns null when there is no natural source', () => {
    expect(eventHref(slug, { namespace: 'system', type: 'email.invite_delivered', payload: {} })).toBeNull();
  });
});

describe('isNotifyWorthyPhase', () => {
  it('keeps single/end/null and drops start', () => {
    expect(isNotifyWorthyPhase('single')).toBe(true);
    expect(isNotifyWorthyPhase('end')).toBe(true);
    expect(isNotifyWorthyPhase(null)).toBe(true);
    expect(isNotifyWorthyPhase('start')).toBe(false);
  });
});
