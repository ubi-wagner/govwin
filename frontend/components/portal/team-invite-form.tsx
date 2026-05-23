'use client';

import { useState, useCallback, useRef } from 'react';

interface TeamInviteFormProps {
  tenantSlug: string;
}

export function TeamInviteForm({ tenantSlug }: TeamInviteFormProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('tenant_user');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const emailRef = useRef(email);
  emailRef.current = email;
  const nameRef = useRef(name);
  nameRef.current = name;
  const roleRef = useRef(role);
  roleRef.current = role;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedEmail = emailRef.current.trim().toLowerCase();
      if (!trimmedEmail || !trimmedEmail.includes('@')) {
        setMessage({ type: 'error', text: 'Please enter a valid email address' });
        return;
      }

      setSubmitting(true);
      setMessage(null);

      try {
        const res = await fetch(`/api/portal/${tenantSlug}/team`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: trimmedEmail,
            name: nameRef.current.trim() || null,
            role: roleRef.current,
          }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Failed to invite' }));
          setMessage({ type: 'error', text: json.error || 'Failed to invite team member' });
          return;
        }

        setMessage({ type: 'success', text: `Invite sent to ${trimmedEmail}` });
        setEmail('');
        setName('');
        setRole('tenant_user');
      } catch {
        setMessage({ type: 'error', text: 'Network error' });
      } finally {
        setSubmitting(false);
      }
    },
    [tenantSlug],
  );

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4">Invite Team Member</h2>

      {message && (
        <div
          className={`text-xs rounded px-3 py-2 mb-4 ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              required
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
          >
            <option value="tenant_user">Contributor</option>
            <option value="tenant_admin">Admin</option>
            <option value="partner_user">External Partner</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Sending...' : 'Send Invite'}
        </button>
      </form>
    </div>
  );
}
