'use client';

/**
 * OpportunityCard — the spine's carrier, rendered. It glues a FROZEN origin
 * (what the opportunity looked like at purchase — proposals.origin_card) to a
 * LIVE projection (build stage, lock state, and the compliance burden computed
 * fresh). The "Origin" tab is frozen; the "Compliance" tab is live — the two are
 * visually labeled so the distinction (3-factor review flaw #7) is obvious.
 *
 * Fed by lib/cards/card.ts:getProposalCard. Dates arrive as ISO strings (the
 * server/client boundary convention in this repo).
 */
import type { ComplianceSummary, OriginCard } from '@/lib/cards/card';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { bucketLabel, complianceProgress, stageMeta, toneClass } from '@/components/cards/card-format';

export interface OpportunityCardView {
  proposalId: string;
  opportunityId: string;
  title: string;
  stage: string;
  isLocked: boolean;
  lockCount: number;
  unlockDeadline: string | null;
  updatedAt: string | null;
  sourceBucket: string | null;
  origin: OriginCard;
  compliance: ComplianceSummary;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function Chip({ tone, children }: { tone: Parameters<typeof toneClass>[0]; children: React.ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${toneClass(tone)}`}>{children}</span>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  // Render a genuine 0 as "0" (a compliance count of 0 is data, not missing);
  // only null/undefined/'' fall back to the em dash.
  const display = value == null || value === '' ? '—' : value;
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right">{display}</span>
    </div>
  );
}

export function OpportunityCard({ card }: { card: OpportunityCardView }) {
  const stage = stageMeta(card.stage);
  const bucket = bucketLabel(card.sourceBucket ?? card.origin.bucket?.key ?? null);
  const opp = card.origin.opportunity ?? {};
  const prog = complianceProgress(card.compliance);

  const overview = (
    <div>
      <Field label="Build stage" value={<Chip tone={stage.tone}>{stage.label}</Chip>} />
      <Field
        label="Workspace"
        value={card.isLocked ? <Chip tone="amber">Locked</Chip> : <Chip tone="green">Open</Chip>}
      />
      <Field label="Times locked" value={card.lockCount} />
      {card.unlockDeadline && <Field label="Unlock deadline" value={fmtDate(card.unlockDeadline)} />}
      {/* Fit — the tenant-to-bucket score (scoring_strategist, via tenant_bucket_scores). The score
          is the frozen purchase-time fit; the bucket label reflects the current spotlight bucket. */}
      <Field
        label="Fit"
        value={
          card.origin.bucket
            ? <Chip tone="purple">{bucketLabel(card.origin.bucket.key)} · score {card.origin.bucket.score}</Chip>
            : bucket ? <Chip tone="purple">{bucket}</Chip> : '—'
        }
      />
      <Field label="Last activity" value={fmtDate(card.updatedAt)} />
    </div>
  );

  // FROZEN origin — captured at purchase, never rewritten by a later amendment.
  const origin = (
    <div>
      <p className="text-xs text-gray-400 mb-2">
        Frozen at purchase{card.origin.frozenAt ? ` · ${fmtDate(card.origin.frozenAt)}` : ''}. A later
        master edit or amendment never rewrites this.
      </p>
      <Field label="Opportunity" value={opp.title} />
      <Field label="Agency" value={opp.agency} />
      <Field label="Program" value={opp.programType} />
      <Field label="Topic #" value={opp.topicNumber} />
      <Field label="Solicitation #" value={opp.solicitationNumber} />
      {card.origin.bucket && (
        <Field
          label="Bought from bucket"
          value={`${bucketLabel(card.origin.bucket.key)} · score ${card.origin.bucket.score}`}
        />
      )}
    </div>
  );

  // LIVE compliance — recomputed every render from the current matrix.
  const compliance = (
    <div>
      <p className="text-xs text-gray-400 mb-2">Live — reflects the current matrix, including amendments.</p>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-700">{prog.label}</span>
        {!prog.empty && <span className="font-medium text-gray-900">{prog.pct}%</span>}
      </div>
      <div className="h-2 w-full rounded bg-gray-100 overflow-hidden">
        <div
          className={`h-full ${prog.tone === 'green' ? 'bg-green-500' : prog.tone === 'amber' ? 'bg-amber-500' : prog.tone === 'red' ? 'bg-red-500' : 'bg-gray-300'}`}
          style={{ width: `${prog.empty ? 0 : prog.pct}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-4 mt-3">
        <Field label="Satisfied" value={card.compliance.satisfied} />
        <Field label="Partial" value={card.compliance.partial} />
        <Field label="Not addressed" value={card.compliance.notAddressed} />
        <Field label="N/A" value={card.compliance.notApplicable} />
        <Field label="Mandatory" value={card.compliance.mandatory} />
        <Field label="Total" value={card.compliance.total} />
      </div>
    </div>
  );

  const tabs: TabDef[] = [
    { key: 'overview', label: 'Overview', content: overview },
    { key: 'origin', label: 'Origin', content: origin },
    { key: 'compliance', label: 'Compliance', content: compliance },
  ];

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-400">Opportunity</div>
          <div className="font-semibold text-gray-900 truncate">{opp.title || card.title}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1 justify-end">
          <Chip tone={stage.tone}>{stage.label}</Chip>
          {card.isLocked && <Chip tone="amber">Locked</Chip>}
        </div>
      </div>
      <Tabs tabs={tabs} />
    </div>
  );
}
