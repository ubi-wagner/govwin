'use client';

import React, { useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MetadataEditorProps {
  tags: string[];
  metadata: Record<string, unknown>;
  onChange: (metadata: Record<string, unknown>) => void;
}

// ─── Section-specific metadata editors ───────────────────────────────────────

function HeroMetadataEditor({
  metadata,
  onChange,
}: {
  metadata: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const primaryCta = (metadata.primary_cta ?? {}) as Record<string, string>;
  const secondaryCta = (metadata.secondary_cta ?? {}) as Record<string, string>;
  const note = (metadata.note ?? '') as string;

  const updatePrimaryCta = (field: string, value: string) => {
    onChange({ ...metadata, primary_cta: { ...primaryCta, [field]: value } });
  };

  const updateSecondaryCta = (field: string, value: string) => {
    onChange({ ...metadata, secondary_cta: { ...secondaryCta, [field]: value } });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Hero Metadata</p>

      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <p className="text-sm font-medium text-gray-700">Primary CTA</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Label</label>
            <input
              type="text"
              value={primaryCta.label ?? ''}
              onChange={(e) => updatePrimaryCta('label', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Apply for Founding Cohort"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Href</label>
            <input
              type="text"
              value={primaryCta.href ?? ''}
              onChange={(e) => updatePrimaryCta('href', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="/apply"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <p className="text-sm font-medium text-gray-700">Secondary CTA</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Label</label>
            <input
              type="text"
              value={secondaryCta.label ?? ''}
              onChange={(e) => updateSecondaryCta('label', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="See How It Works"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Href</label>
            <input
              type="text"
              value={secondaryCta.href ?? ''}
              onChange={(e) => updateSecondaryCta('href', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="/value"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Note (subtext below hero)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => onChange({ ...metadata, note: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Platform launches August 2026..."
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Before You Apply (apply page hero)</label>
        <textarea
          value={(metadata.before_you_apply ?? '') as string}
          onChange={(e) => onChange({ ...metadata, before_you_apply: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Optional notice text for apply page hero"
        />
      </div>
    </div>
  );
}

function StatsMetadataEditor({
  metadata,
  onChange,
}: {
  metadata: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const value = (metadata.value ?? '') as string;
  const label = (metadata.label ?? '') as string;
  const suffix = (metadata.suffix ?? '') as string;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Stats Metadata</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Value</label>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange({ ...metadata, value: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="150+"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => onChange({ ...metadata, label: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="Active Users"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Suffix</label>
          <input
            type="text"
            value={suffix}
            onChange={(e) => onChange({ ...metadata, suffix: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="%"
          />
        </div>
      </div>
    </div>
  );
}

function PricingMetadataEditor({
  metadata,
  onChange,
}: {
  metadata: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const price = (metadata.price ?? '') as string;
  const period = (metadata.period ?? '') as string;
  const note = (metadata.note ?? '') as string;
  const priceLabel = (metadata.price_label ?? '') as string;
  const features = (metadata.features ?? []) as string[];

  const updateFeature = (index: number, value: string) => {
    const updated = [...features];
    updated[index] = value;
    onChange({ ...metadata, features: updated });
  };

  const addFeature = () => {
    onChange({ ...metadata, features: [...features, ''] });
  };

  const removeFeature = (index: number) => {
    onChange({ ...metadata, features: features.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pricing Metadata</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Price</label>
          <input
            type="text"
            value={price}
            onChange={(e) => onChange({ ...metadata, price: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="$499"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Period</label>
          <input
            type="text"
            value={period}
            onChange={(e) => onChange({ ...metadata, period: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="/month"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Price Label (value page)</label>
        <input
          type="text"
          value={priceLabel}
          onChange={(e) => onChange({ ...metadata, price_label: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="$499/mo - Cancel Anytime"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Note</label>
        <input
          type="text"
          value={note}
          onChange={(e) => onChange({ ...metadata, note: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Cancel anytime"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Features List</label>
        <div className="space-y-2">
          {features.map((feature, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={feature}
                onChange={(e) => updateFeature(i, e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={`Feature ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeFeature(i)}
                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addFeature}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + Add Feature
          </button>
        </div>
      </div>
    </div>
  );
}

function CtaMetadataEditor({
  metadata,
  onChange,
}: {
  metadata: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const cta = (metadata.cta ?? {}) as Record<string, string>;
  const note = (metadata.note ?? '') as string;

  const updateCta = (field: string, value: string) => {
    onChange({ ...metadata, cta: { ...cta, [field]: value } });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">CTA Metadata</p>
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">CTA Label</label>
            <input
              type="text"
              value={cta.label ?? ''}
              onChange={(e) => updateCta('label', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Apply Now"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">CTA Href</label>
            <input
              type="text"
              value={cta.href ?? ''}
              onChange={(e) => updateCta('href', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="/apply"
            />
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Note</label>
        <input
          type="text"
          value={note}
          onChange={(e) => onChange({ ...metadata, note: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Limited seats available"
        />
      </div>
    </div>
  );
}

function StepsMetadataEditor({
  metadata,
  onChange,
}: {
  metadata: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const number = (metadata.number ?? '') as string;
  const num = (metadata.num ?? '') as string;
  const details = (metadata.details ?? []) as string[];

  const updateDetail = (index: number, value: string) => {
    const updated = [...details];
    updated[index] = value;
    onChange({ ...metadata, details: updated });
  };

  const addDetail = () => {
    onChange({ ...metadata, details: [...details, ''] });
  };

  const removeDetail = (index: number) => {
    onChange({ ...metadata, details: details.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Step/Stage Metadata</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Number</label>
          <input
            type="text"
            value={number || num}
            onChange={(e) => onChange({ ...metadata, number: e.target.value, num: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="01"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Detail Points</label>
        <div className="space-y-2">
          {details.map((detail, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={detail}
                onChange={(e) => updateDetail(i, e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={`Detail ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeDetail(i)}
                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addDetail}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + Add Detail
          </button>
        </div>
      </div>
    </div>
  );
}

function FeaturesMetadataEditor({
  metadata,
  onChange,
}: {
  metadata: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const icon = (metadata.icon ?? '') as string;
  const href = (metadata.href ?? '') as string;
  const items = (metadata.items ?? []) as string[];

  const updateItem = (index: number, value: string) => {
    const updated = [...items];
    updated[index] = value;
    onChange({ ...metadata, items: updated });
  };

  const addItem = () => {
    onChange({ ...metadata, items: [...items, ''] });
  };

  const removeItem = (index: number) => {
    onChange({ ...metadata, items: items.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Feature/Item Metadata</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Icon (emoji or icon name)</label>
          <input
            type="text"
            value={icon}
            onChange={(e) => onChange({ ...metadata, icon: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="search"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Link href</label>
          <input
            type="text"
            value={href}
            onChange={(e) => onChange({ ...metadata, href: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="/features#scoring"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Items List</label>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={item}
                onChange={(e) => updateItem(i, e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={`Item ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + Add Item
          </button>
        </div>
      </div>
    </div>
  );
}

function ExpertGateMetadataEditor({
  metadata,
  onChange,
}: {
  metadata: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const expertName = (metadata.expert_name ?? '') as string;
  const bullets = (metadata.bullets ?? []) as string[];

  const updateBullet = (index: number, value: string) => {
    const updated = [...bullets];
    updated[index] = value;
    onChange({ ...metadata, bullets: updated });
  };

  const addBullet = () => {
    onChange({ ...metadata, bullets: [...bullets, ''] });
  };

  const removeBullet = (index: number) => {
    onChange({ ...metadata, bullets: bullets.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Expert Gate Metadata</p>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Expert Name</label>
        <input
          type="text"
          value={expertName}
          onChange={(e) => onChange({ ...metadata, expert_name: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Eric Wagner"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Bullet Points</label>
        <div className="space-y-2">
          {bullets.map((bullet, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={bullet}
                onChange={(e) => updateBullet(i, e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={`Bullet ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeBullet(i)}
                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addBullet}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + Add Bullet
          </button>
        </div>
      </div>
    </div>
  );
}

function SlaMetadataEditor({
  metadata,
  onChange,
}: {
  metadata: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const slaLabel = (metadata.sla_label ?? '') as string;
  const priceLabel = (metadata.price_label ?? '') as string;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Section Metadata</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">SLA Label</label>
          <input
            type="text"
            value={slaLabel}
            onChange={(e) => onChange({ ...metadata, sla_label: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="72-hour SLA"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Price Label</label>
          <input
            type="text"
            value={priceLabel}
            onChange={(e) => onChange({ ...metadata, price_label: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="$499/mo"
          />
        </div>
      </div>
    </div>
  );
}

function JsonFallbackEditor({
  metadata,
  onChange,
}: {
  metadata: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const [jsonText, setJsonText] = useState(JSON.stringify(metadata, null, 2));
  const [jsonError, setJsonError] = useState('');

  const handleChange = useCallback(
    (text: string) => {
      setJsonText(text);
      try {
        const parsed = JSON.parse(text);
        setJsonError('');
        onChange(parsed);
      } catch {
        setJsonError('Invalid JSON');
      }
    },
    [onChange],
  );

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Metadata (Raw JSON)</p>
      <textarea
        value={jsonText}
        onChange={(e) => handleChange(e.target.value)}
        rows={8}
        className={`w-full rounded-md border px-3 py-2 text-sm font-mono focus:ring-1 ${
          jsonError
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
            : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
        }`}
        placeholder="{}"
      />
      {jsonError && <p className="text-xs text-red-600">{jsonError}</p>}
    </div>
  );
}

// ─── Section detection helper ────────────────────────────────────────────────

function detectSectionType(tags: string[]): string {
  const sectionTags = new Set(tags.map((t) => t.toLowerCase()));

  if (sectionTags.has('hero') || sectionTags.has('pricing-hero')) return 'hero';
  if (sectionTags.has('stats')) return 'stats';
  if (sectionTags.has('pricing')) return 'pricing';
  if (sectionTags.has('cta')) return 'cta';
  if (sectionTags.has('stages') || sectionTags.has('steps')) return 'steps';
  if (sectionTags.has('features') || sectionTags.has('items') || sectionTags.has('pillars') || sectionTags.has('guardrails')) return 'features';
  if (sectionTags.has('expert-gate')) return 'expert-gate';
  if (sectionTags.has('curation') || sectionTags.has('spotlight') || sectionTags.has('portals') || sectionTags.has('flywheel')) return 'sla';
  return 'json';
}

// ─── Main metadata editor ────────────────────────────────────────────────────

export default function MetadataEditor({ tags, metadata, onChange }: MetadataEditorProps) {
  const sectionType = detectSectionType(tags);

  const [showRawJson, setShowRawJson] = useState(false);

  return (
    <div className="space-y-4">
      {/* Structured editor based on section type */}
      {sectionType === 'hero' && <HeroMetadataEditor metadata={metadata} onChange={onChange} />}
      {sectionType === 'stats' && <StatsMetadataEditor metadata={metadata} onChange={onChange} />}
      {sectionType === 'pricing' && <PricingMetadataEditor metadata={metadata} onChange={onChange} />}
      {sectionType === 'cta' && <CtaMetadataEditor metadata={metadata} onChange={onChange} />}
      {sectionType === 'steps' && <StepsMetadataEditor metadata={metadata} onChange={onChange} />}
      {sectionType === 'features' && <FeaturesMetadataEditor metadata={metadata} onChange={onChange} />}
      {sectionType === 'expert-gate' && <ExpertGateMetadataEditor metadata={metadata} onChange={onChange} />}
      {sectionType === 'sla' && <SlaMetadataEditor metadata={metadata} onChange={onChange} />}
      {sectionType === 'json' && <JsonFallbackEditor metadata={metadata} onChange={onChange} />}

      {/* Toggle raw JSON view for structured editors */}
      {sectionType !== 'json' && (
        <div className="pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowRawJson(!showRawJson)}
            className="text-xs text-gray-500 hover:text-gray-700 font-medium"
          >
            {showRawJson ? 'Hide Raw JSON' : 'Show Raw JSON'}
          </button>
          {showRawJson && (
            <div className="mt-2">
              <JsonFallbackEditor metadata={metadata} onChange={onChange} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
