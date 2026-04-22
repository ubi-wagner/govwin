'use client';

import { useState } from 'react';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const TECH_AREAS = [
  'AI / Machine Learning', 'Autonomy / Robotics', 'Quantum', 'Cyber / Security',
  'Biotech / Health', 'Materials / Manufacturing', 'Space', 'Energy / Power',
  'Communications / 5G/6G', 'Directed Energy', 'Sensing', 'Software / SaaS',
  'Hardware / IoT', 'Other',
];

const TARGET_PROGRAMS = ['SBIR Phase I', 'SBIR Phase II', 'STTR Phase I', 'STTR Phase II', 'BAA', 'OTA', 'CSO', 'NSF Grants', 'DOE Funding Opportunities', 'NIH / HHS'];

const TARGET_AGENCIES = ['DoD (General)', 'USAF / DAF / AFWERX', 'Army / DEVCOM', 'Navy / ONR', 'DARPA', 'SOCOM', 'NSF', 'NIH', 'DOE / ARPA-E', 'DOT', 'DHS', 'NASA', 'USDA', 'Other'];

const DESIRED_OUTCOMES = [
  'Daily opportunity Spotlight',
  'AI-assisted proposal drafting',
  'Expert curation of compliance matrices',
  'Strategic pursuit recommendations',
  'Collaboration tools for my team and partners',
  'Past-performance library management',
  'Ongoing BD advisory from an expert',
];

export function ApplicationForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [techAreas, setTechAreas] = useState<string[]>([]);
  const [targetPrograms, setTargetPrograms] = useState<string[]>([]);
  const [targetAgencies, setTargetAgencies] = useState<string[]>([]);
  const [desiredOutcomes, setDesiredOutcomes] = useState<string[]>([]);

  function toggle(list: string[], setList: (x: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');
    setError(null);

    const form = event.currentTarget;
    const data = new FormData(form);

    const payload = {
      contactEmail: String(data.get('contactEmail') ?? '').trim(),
      contactName: String(data.get('contactName') ?? '').trim(),
      contactTitle: String(data.get('contactTitle') ?? '').trim() || null,
      contactPhone: String(data.get('contactPhone') ?? '').trim() || null,
      companyName: String(data.get('companyName') ?? '').trim(),
      companyWebsite: String(data.get('companyWebsite') ?? '').trim() || null,
      companySize: String(data.get('companySize') ?? '') || null,
      companyState: String(data.get('companyState') ?? '').trim() || null,
      samRegistered: data.get('samRegistered') === 'yes',
      samCageCode: String(data.get('samCageCode') ?? '').trim() || null,
      dunsUei: String(data.get('dunsUei') ?? '').trim() || null,
      previousSubmissions: parseInt(String(data.get('previousSubmissions') ?? '0'), 10) || 0,
      previousAwards: parseInt(String(data.get('previousAwards') ?? '0'), 10) || 0,
      previousAwardPrograms: String(data.get('previousAwardPrograms') ?? '').trim() || null,
      techSummary: String(data.get('techSummary') ?? '').trim(),
      techAreas,
      targetPrograms,
      targetAgencies,
      desiredOutcomes,
      motivation: String(data.get('motivation') ?? '').trim() || null,
      referralSource: String(data.get('referralSource') ?? '').trim() || null,
      termsAccepted: data.get('termsAccepted') === 'on',
    };

    if (!payload.termsAccepted) {
      setError('You must accept the Terms & Conditions to apply.');
      setStatus('error');
      return;
    }

    try {
      const resp = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) {
        throw new Error(json.error ?? `Submission failed (HTTP ${resp.status})`);
      }
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className="p-8 bg-emerald-50 border-2 border-emerald-200 rounded-lg">
        <h2 className="font-display text-2xl font-bold text-emerald-800">Application received</h2>
        <p className="mt-4 text-gray-700 leading-relaxed">
          Thanks for applying. Eric will personally review your application within 72 hours and
          reach out directly at the email you provided with next steps. If you&rsquo;re accepted,
          you&rsquo;ll be invited to onboard, register your admin, upload foundational company
          documents, and activate your $299/month Spotlight subscription.
        </p>
        <p className="mt-4 text-gray-700">
          If you have any urgent questions in the meantime, email{' '}
          <a href="mailto:eric@rfppipeline.com" className="text-brand-600 hover:text-brand-800 underline">
            eric@rfppipeline.com
          </a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      {/* Contact */}
      <Fieldset title="Admin Contact" description="The primary administrator for your company's RFP Pipeline workspace.">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Full name" required>
            <input name="contactName" required className="form-input" type="text" />
          </Field>
          <Field label="Email" required>
            <input name="contactEmail" required type="email" className="form-input" />
          </Field>
          <Field label="Title / Role">
            <input name="contactTitle" type="text" className="form-input" placeholder="e.g. CEO, CTO, Founder" />
          </Field>
          <Field label="Phone">
            <input name="contactPhone" type="tel" className="form-input" />
          </Field>
        </div>
      </Fieldset>

      {/* Company */}
      <Fieldset title="Company" description="Basic information about your small business.">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Company name" required>
            <input name="companyName" required type="text" className="form-input" />
          </Field>
          <Field label="Website">
            <input name="companyWebsite" type="url" className="form-input" placeholder="https://..." />
          </Field>
          <Field label="Company size">
            <select name="companySize" className="form-input">
              <option value="">Select...</option>
              <option>1–5 employees</option>
              <option>6–20 employees</option>
              <option>21–50 employees</option>
              <option>51–100 employees</option>
              <option>100+ employees</option>
            </select>
          </Field>
          <Field label="State">
            <input name="companyState" type="text" maxLength={50} className="form-input" placeholder="e.g. Ohio" />
          </Field>
        </div>
      </Fieldset>

      {/* Federal readiness */}
      <Fieldset title="Federal Readiness" description="Required for federal contracting. We'll help you check these boxes if you're not yet registered.">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="SAM.gov registered?" required>
            <div className="flex gap-4 mt-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="samRegistered" value="yes" required /> Yes
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="samRegistered" value="no" /> No
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="samRegistered" value="in_progress" /> In progress
              </label>
            </div>
          </Field>
          <Field label="CAGE code (if any)">
            <input name="samCageCode" type="text" className="form-input" />
          </Field>
          <Field label="UEI / DUNS (if any)">
            <input name="dunsUei" type="text" className="form-input" />
          </Field>
        </div>
        <div className="grid md:grid-cols-3 gap-4 mt-4">
          <Field label="Previous federal proposals submitted">
            <input name="previousSubmissions" type="number" min="0" defaultValue="0" className="form-input" />
          </Field>
          <Field label="Previous federal awards received">
            <input name="previousAwards" type="number" min="0" defaultValue="0" className="form-input" />
          </Field>
          <Field label="Previous award programs (if any)">
            <input name="previousAwardPrograms" type="text" className="form-input" placeholder="e.g. SBIR Phase I, BAA" />
          </Field>
        </div>
      </Fieldset>

      {/* Technology + pursuit */}
      <Fieldset
        title="Technology & Funding Pursuit"
        description="Tell us what you're building and what federal R&D funding you want to pursue. Eric uses this to assess fit and tailor your Spotlight filters."
      >
        <Field label="Technology summary (2-4 sentences)" required>
          <textarea
            name="techSummary"
            required
            rows={4}
            className="form-input"
            placeholder="What's your technology? What problem does it solve? What's the commercialization or federal mission relevance?"
          />
        </Field>

        <ChipGroup
          label="Tech areas (select all that apply)"
          options={TECH_AREAS}
          selected={techAreas}
          onToggle={(v) => toggle(techAreas, setTechAreas, v)}
        />

        <ChipGroup
          label="Target programs (select all you're pursuing or want to pursue)"
          options={TARGET_PROGRAMS}
          selected={targetPrograms}
          onToggle={(v) => toggle(targetPrograms, setTargetPrograms, v)}
        />

        <ChipGroup
          label="Target agencies (select all that apply)"
          options={TARGET_AGENCIES}
          selected={targetAgencies}
          onToggle={(v) => toggle(targetAgencies, setTargetAgencies, v)}
        />

        <ChipGroup
          label="Desired outcomes from using RFP Pipeline"
          options={DESIRED_OUTCOMES}
          selected={desiredOutcomes}
          onToggle={(v) => toggle(desiredOutcomes, setDesiredOutcomes, v)}
        />
      </Fieldset>

      {/* Why */}
      <Fieldset title="Why RFP Pipeline?" description="Optional but helpful context.">
        <Field label="What's driving your interest right now?">
          <textarea
            name="motivation"
            rows={3}
            className="form-input"
            placeholder="E.g. upcoming AFWERX cycle, Phase II gap, commercializing IP from a specific R&D effort..."
          />
        </Field>
        <Field label="How did you hear about us?">
          <input name="referralSource" type="text" className="form-input" placeholder="LinkedIn, referral, search, event..." />
        </Field>
      </Fieldset>

      {/* Terms */}
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <label className="flex items-start gap-3 text-sm text-gray-700">
          <input type="checkbox" name="termsAccepted" required className="mt-1" />
          <span>
            I have read and agree to the{' '}
            <a href="/legal/terms" target="_blank" className="text-brand-600 hover:text-brand-800 underline">
              Terms &amp; Conditions
            </a>{' '}
            and acknowledge that (a) acceptance is at Eric&rsquo;s discretion, (b) if accepted,
            I will onboard by registering my admin, uploading foundational company documents,
            and activating a $299/month Spotlight subscription via Stripe, and (c) there is no
            free trial but subscriptions may be canceled at any time.
          </span>
        </label>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="px-10 py-4 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-lg font-semibold rounded-lg shadow-lg transition-all"
        >
          {status === 'submitting' ? 'Submitting...' : 'Submit Application'}
        </button>
      </div>

      <style jsx global>{`
        .form-input {
          width: 100%;
          padding: 0.625rem 0.875rem;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .form-input:focus {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }
      `}</style>
    </form>
  );
}

function Fieldset({
  title, description, children,
}: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend>
        <h2 className="font-display text-xl font-bold text-navy-800">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function ChipGroup({
  label, options, selected, onToggle,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <span className="block text-sm font-medium text-gray-700 mb-2">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isSelected = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                isSelected
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-brand-400'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
