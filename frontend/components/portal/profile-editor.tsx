'use client';

import { useState, useCallback } from 'react';

interface TenantInfoProps {
  name: string;
  legalName: string | null;
  website: string | null;
  billingEmail: string | null;
}

interface ProfileProps {
  naicsCodes: string[];
  keywords: string[];
  technologyFocus: string | null;
  companySummary: string | null;
  researchAreas: string[];
  targetAgencies: string[];
  setAsideTypes: string[];
}

interface ProfileEditorProps {
  tenantSlug: string;
  canEdit: boolean;
  tenantInfo: TenantInfoProps | null;
  profile: ProfileProps | null;
}

export function ProfileEditor({ tenantSlug, canEdit, tenantInfo, profile }: ProfileEditorProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [formData, setFormData] = useState({
    name: tenantInfo?.name ?? '',
    legalName: tenantInfo?.legalName ?? '',
    website: tenantInfo?.website ?? '',
    billingEmail: tenantInfo?.billingEmail ?? '',
    companySummary: profile?.companySummary ?? '',
    technologyFocus: profile?.technologyFocus ?? '',
    naicsCodes: (profile?.naicsCodes ?? []).join(', '),
    keywords: (profile?.keywords ?? []).join(', '),
    targetAgencies: (profile?.targetAgencies ?? []).join(', '),
    setAsideTypes: (profile?.setAsideTypes ?? []).join(', '),
    researchAreas: (profile?.researchAreas ?? []).join(', '),
  });

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          legalName: formData.legalName || null,
          website: formData.website || null,
          billingEmail: formData.billingEmail || null,
          companySummary: formData.companySummary || null,
          technologyFocus: formData.technologyFocus || null,
          naicsCodes: formData.naicsCodes.split(',').map(s => s.trim()).filter(Boolean),
          keywords: formData.keywords.split(',').map(s => s.trim()).filter(Boolean),
          targetAgencies: formData.targetAgencies.split(',').map(s => s.trim()).filter(Boolean),
          setAsideTypes: formData.setAsideTypes.split(',').map(s => s.trim()).filter(Boolean),
          researchAreas: formData.researchAreas.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Save failed' }));
        setMessage({ type: 'error', text: json.error ?? 'Save failed' });
        return;
      }

      setMessage({ type: 'success', text: 'Profile saved successfully' });
      setEditing(false);
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(false);
    }
  }, [tenantSlug, formData]);

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (!editing) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Company Profile</h2>
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 text-sm font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
            >
              Edit
            </button>
          )}
        </div>

        {message && (
          <div className={`text-xs rounded px-3 py-2 mb-4 ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}>
            {message.text}
          </div>
        )}

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <div>
            <dt className="text-gray-500">Company Name</dt>
            <dd className="font-medium text-gray-900 mt-0.5">{tenantInfo?.name ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Legal Name</dt>
            <dd className="font-medium text-gray-900 mt-0.5">{tenantInfo?.legalName ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Website</dt>
            <dd className="font-medium text-gray-900 mt-0.5">
              {tenantInfo?.website ? (
                <a href={tenantInfo.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {tenantInfo.website}
                </a>
              ) : '-'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Billing Email</dt>
            <dd className="font-medium text-gray-900 mt-0.5">{tenantInfo?.billingEmail ?? '-'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-gray-500">Company Summary</dt>
            <dd className="font-medium text-gray-900 mt-0.5">{profile?.companySummary ?? '-'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-gray-500">Technology Focus</dt>
            <dd className="font-medium text-gray-900 mt-0.5">{profile?.technologyFocus ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">NAICS Codes</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {(profile?.naicsCodes ?? []).length > 0
                ? profile!.naicsCodes.map(code => (
                    <span key={code} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                      {code}
                    </span>
                  ))
                : <span className="text-gray-400 text-xs">None set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Set-Aside Types</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {(profile?.setAsideTypes ?? []).length > 0
                ? profile!.setAsideTypes.map(t => (
                    <span key={t} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700">
                      {t}
                    </span>
                  ))
                : <span className="text-gray-400 text-xs">None set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Target Agencies</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {(profile?.targetAgencies ?? []).length > 0
                ? profile!.targetAgencies.map(a => (
                    <span key={a} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
                      {a}
                    </span>
                  ))
                : <span className="text-gray-400 text-xs">None set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Keywords</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {(profile?.keywords ?? []).length > 0
                ? profile!.keywords.map(k => (
                    <span key={k} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                      {k}
                    </span>
                  ))
                : <span className="text-gray-400 text-xs">None set</span>}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-gray-500">Research Areas</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {(profile?.researchAreas ?? []).length > 0
                ? profile!.researchAreas.map(r => (
                    <span key={r} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700">
                      {r}
                    </span>
                  ))
                : <span className="text-gray-400 text-xs">None set</span>}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-gray-400 mt-6 border-t border-gray-100 pt-4">
          These fields feed into proposal templates and AI drafting. Keep them current for accurate merge fields.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Edit Company Profile</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setEditing(false); setMessage(null); }}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`text-xs rounded px-3 py-2 mb-4 ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
        }`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Company Name" value={formData.name} onChange={v => handleChange('name', v)} />
        <Field label="Legal Name" value={formData.legalName} onChange={v => handleChange('legalName', v)} />
        <Field label="Website" value={formData.website} onChange={v => handleChange('website', v)} />
        <Field label="Billing Email" value={formData.billingEmail} onChange={v => handleChange('billingEmail', v)} />
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Company Summary</label>
          <textarea
            value={formData.companySummary}
            onChange={e => handleChange('companySummary', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="md:col-span-2">
          <Field label="Technology Focus" value={formData.technologyFocus} onChange={v => handleChange('technologyFocus', v)} />
        </div>
        <Field label="NAICS Codes (comma-separated)" value={formData.naicsCodes} onChange={v => handleChange('naicsCodes', v)} />
        <Field label="Keywords (comma-separated)" value={formData.keywords} onChange={v => handleChange('keywords', v)} />
        <Field label="Target Agencies (comma-separated)" value={formData.targetAgencies} onChange={v => handleChange('targetAgencies', v)} />
        <Field label="Set-Aside Types (comma-separated)" value={formData.setAsideTypes} onChange={v => handleChange('setAsideTypes', v)} />
        <div className="md:col-span-2">
          <Field label="Research Areas (comma-separated)" value={formData.researchAreas} onChange={v => handleChange('researchAreas', v)} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
      />
    </div>
  );
}
