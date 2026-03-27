"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

interface LeadDetail {
  id: number;
  name: string;
  address: string;
  county: string;
  latitude: number;
  longitude: number;
  characteristics: Record<string, unknown> | null;
  contacts: { name: string; title: string }[];
  assets: { doc_type: string; extracted_text: string }[];
  emails: { style: string; subject: string; body: string }[] | null;
}

export default function LeadDetailPage() {
  const params = useParams();
  const leadId = params.id as string;

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<"info" | "emails">("info");

  async function fetchLead() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/leads/${leadId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to load lead");
        return;
      }
      const data = await res.json();
      setLead(data.data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLead();
  }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDeepDive() {
    setAnalyzing(true);
    setError("");
    try {
      const res = await apiFetch(`/api/leads/${leadId}/analyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Analysis failed");
        return;
      }
      fetchLead();
    } catch {
      setError("Network error during analysis");
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error)
    return (
      <div className="space-y-2">
        <p className="text-red-400">{error}</p>
        <button onClick={fetchLead} className="text-sm underline">
          Retry
        </button>
      </div>
    );
  if (!lead) return <p className="text-gray-500">Lead not found.</p>;

  const chars = lead.characteristics || {};

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">{lead.name}</h2>
          <p className="text-sm text-gray-400">{lead.address}</p>
          <p className="text-sm text-gray-500">{lead.county} County</p>
        </div>
        <button
          onClick={handleDeepDive}
          disabled={analyzing}
          className="rounded bg-purple-700 px-4 py-2 text-sm font-semibold hover:bg-purple-600 transition disabled:opacity-50"
        >
          {analyzing ? "Analyzing..." : "Run Deep Dive"}
        </button>
      </div>

      {/* Extracted Characteristics */}
      {Object.keys(chars).length > 0 && (
        <div className="rounded border border-gray-800 bg-gray-900 p-4 space-y-2">
          <h3 className="font-semibold text-sm uppercase text-gray-400">
            Extracted Intel
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(chars).map(([k, v]) => (
              <div key={k}>
                <span className="text-gray-500">{k}: </span>
                <span>{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contacts */}
      {lead.contacts.length > 0 && (
        <div className="rounded border border-gray-800 bg-gray-900 p-4 space-y-2">
          <h3 className="font-semibold text-sm uppercase text-gray-400">
            Decision Makers
          </h3>
          {lead.contacts.map((c, i) => (
            <p key={i} className="text-sm">
              {c.name}{c.title ? ` — ${c.title}` : ""}
            </p>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        <button
          onClick={() => setActiveTab("info")}
          className={`px-3 py-1 text-sm rounded-t transition ${
            activeTab === "info" ? "bg-gray-800" : "hover:bg-gray-800/50"
          }`}
        >
          Documents
        </button>
        <button
          onClick={() => setActiveTab("emails")}
          className={`px-3 py-1 text-sm rounded-t transition ${
            activeTab === "emails" ? "bg-gray-800" : "hover:bg-gray-800/50"
          }`}
        >
          Email Drafts
        </button>
      </div>

      {/* Document Assets */}
      {activeTab === "info" && (
        <div className="space-y-4">
          {lead.assets.length === 0 ? (
            <p className="text-gray-500 text-sm">No documents attached.</p>
          ) : (
            lead.assets.map((a, i) => (
              <details key={i} className="rounded border border-gray-800 bg-gray-900">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  {a.doc_type}
                </summary>
                <pre className="whitespace-pre-wrap p-4 text-xs text-gray-300 max-h-96 overflow-y-auto">
                  {a.extracted_text || "No text extracted."}
                </pre>
              </details>
            ))
          )}
        </div>
      )}

      {/* Email Drafts */}
      {activeTab === "emails" && (
        <div className="space-y-4">
          {!lead.emails || lead.emails.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No emails generated yet. Click &quot;Run Deep Dive&quot; to generate outreach drafts.
            </p>
          ) : (
            lead.emails.map((e, i) => (
              <div key={i} className="rounded border border-gray-800 bg-gray-900 p-4 space-y-2">
                <h4 className="text-sm font-semibold text-blue-400">
                  {e.style}
                </h4>
                <p className="text-sm font-medium">{e.subject}</p>
                <pre className="whitespace-pre-wrap text-xs text-gray-300">
                  {e.body}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
