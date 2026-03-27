"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import Link from "next/link";

interface Lead {
  id: number;
  name: string;
  address: string;
  county: string;
  latitude: number;
  longitude: number;
  characteristics: Record<string, unknown> | null;
  created_at: string;
  latest_action: string | null;
}

type SortBy = "date" | "coast_distance";

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("date");

  async function fetchLeads() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/leads?sort=${sortBy}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to load leads");
        return;
      }
      const data = await res.json();
      setLeads(data.data || []);
    } catch {
      setError("Network error — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLeads();
  }, [sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleVote(entityId: number, action: "USER_THUMB_UP" | "USER_THUMB_DOWN") {
    try {
      const res = await apiFetch("/api/ledger", {
        method: "POST",
        body: JSON.stringify({ entity_id: entityId, action_type: action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to record vote");
        return;
      }
      fetchLeads();
    } catch {
      setError("Network error");
    }
  }

  function staticMapUrl(lat: number, lng: number) {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=18&size=400x250&maptype=satellite&key=${key}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Lead Pipeline</h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Sort by:</span>
          <button
            onClick={() => setSortBy("date")}
            className={`rounded px-3 py-1 transition ${
              sortBy === "date"
                ? "bg-blue-600"
                : "bg-gray-800 hover:bg-gray-700"
            }`}
          >
            Date Found
          </button>
          <button
            onClick={() => setSortBy("coast_distance")}
            className={`rounded px-3 py-1 transition ${
              sortBy === "coast_distance"
                ? "bg-blue-600"
                : "bg-gray-800 hover:bg-gray-700"
            }`}
          >
            Coast Distance
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded bg-red-900/50 p-3 text-sm text-red-300">
          <span>{error}</span>
          <button onClick={fetchLeads} className="underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Loading leads...</p>
      ) : leads.length === 0 ? (
        <p className="text-gray-500">
          No leads found. Draw a region on the map to start hunting.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {leads.map((lead) => (
            <div
              key={lead.id}
              className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900"
            >
              {/* Satellite image */}
              {lead.latitude && lead.longitude && (
                <img
                  src={staticMapUrl(lead.latitude, lead.longitude)}
                  alt={`Satellite view of ${lead.name}`}
                  className="h-44 w-full object-cover"
                />
              )}

              <div className="p-4 space-y-2">
                <h3 className="font-semibold truncate">{lead.name}</h3>
                <p className="text-xs text-gray-400 truncate">{lead.address}</p>
                <p className="text-xs text-gray-500">
                  {lead.county} County &bull;{" "}
                  {new Date(lead.created_at).toLocaleDateString()}
                </p>

                {lead.latest_action && (
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      lead.latest_action === "USER_THUMB_UP"
                        ? "bg-green-900/50 text-green-300"
                        : lead.latest_action === "USER_THUMB_DOWN"
                        ? "bg-red-900/50 text-red-300"
                        : "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {lead.latest_action === "USER_THUMB_UP"
                      ? "Candidate"
                      : lead.latest_action === "USER_THUMB_DOWN"
                      ? "Rejected"
                      : "New"}
                  </span>
                )}

                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={() => handleVote(lead.id, "USER_THUMB_UP")}
                    className="flex-1 rounded bg-green-800 py-1.5 text-sm hover:bg-green-700 transition"
                    title="Thumbs Up — mark as candidate"
                  >
                    &uarr; Up
                  </button>
                  <button
                    onClick={() => handleVote(lead.id, "USER_THUMB_DOWN")}
                    className="flex-1 rounded bg-red-800 py-1.5 text-sm hover:bg-red-700 transition"
                    title="Thumbs Down — reject lead"
                  >
                    &darr; Down
                  </button>
                  {lead.latest_action === "USER_THUMB_UP" && (
                    <Link
                      href={`/dashboard/lead/${lead.id}`}
                      className="flex-1 rounded bg-blue-700 py-1.5 text-center text-sm hover:bg-blue-600 transition"
                    >
                      Details
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
