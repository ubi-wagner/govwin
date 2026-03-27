"use client";

import { useState, useCallback, useRef } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import { apiFetch } from "@/lib/api";

const libraries: ("drawing" | "places")[] = ["drawing", "places"];
const mapContainerStyle = { width: "100%", height: "calc(100vh - 140px)" };
const defaultCenter = { lat: 27.77, lng: -82.64 }; // Tampa Bay area

export default function DashboardMapPage() {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const [zipSearch, setZipSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [drawnBounds, setDrawnBounds] = useState<{
    north: number;
    south: number;
    east: number;
    west: number;
  } | null>(null);
  const [regionName, setRegionName] = useState("");
  const [stories, setStories] = useState(3);
  const [coastDistance, setCoastDistance] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;

    const drawingManager = new google.maps.drawing.DrawingManager({
      drawingMode: null,
      drawingControl: true,
      drawingControlOptions: {
        position: google.maps.ControlPosition.TOP_CENTER,
        drawingModes: [google.maps.drawing.OverlayType.RECTANGLE],
      },
      rectangleOptions: {
        fillColor: "#3b82f6",
        fillOpacity: 0.15,
        strokeColor: "#3b82f6",
        strokeWeight: 2,
        editable: true,
      },
    });

    drawingManager.setMap(map);

    google.maps.event.addListener(
      drawingManager,
      "rectanglecomplete",
      (rect: google.maps.Rectangle) => {
        const bounds = rect.getBounds();
        if (!bounds) return;
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        setDrawnBounds({
          north: ne.lat(),
          south: sw.lat(),
          east: ne.lng(),
          west: sw.lng(),
        });
        setShowModal(true);
        drawingManager.setDrawingMode(null);
      }
    );
  }, []);

  function handleZipSearch() {
    if (!mapRef.current || !zipSearch.trim()) return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: zipSearch + ", FL" }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        const loc = results[0].geometry.location;
        mapRef.current?.panTo(loc);
        mapRef.current?.setZoom(14);
      }
    });
  }

  async function handleSubmitRegion() {
    if (!drawnBounds || !regionName.trim()) return;
    setSubmitting(true);
    setMessage("");

    try {
      const res = await apiFetch("/api/regions", {
        method: "POST",
        body: JSON.stringify({
          name: regionName,
          bounding_box: drawnBounds,
          parameters: {
            stories,
            coast_distance: coastDistance,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage(err.error || "Failed to create region");
      } else {
        setMessage("Region created successfully!");
        setShowModal(false);
        setRegionName("");
      }
    } catch {
      setMessage("Network error — is the backend running?");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-400">Loading map...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Zip code search */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search Zip Code..."
          value={zipSearch}
          onChange={(e) => setZipSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleZipSearch()}
          className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm w-64 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={handleZipSearch}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 transition"
        >
          Go
        </button>
      </div>

      {/* Map */}
      <div className="rounded-lg overflow-hidden border border-gray-800">
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={defaultCenter}
          zoom={10}
          onLoad={onMapLoad}
          options={{
            mapTypeId: "hybrid",
            mapTypeControl: true,
          }}
        />
      </div>

      {message && (
        <p className="text-sm text-green-400">{message}</p>
      )}

      {/* Region Creation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6 space-y-4">
            <h2 className="text-lg font-bold">Define Hunt Region</h2>

            <div className="space-y-2">
              <label className="block text-sm font-medium">Region Name</label>
              <input
                type="text"
                value={regionName}
                onChange={(e) => setRegionName(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="e.g. Clearwater Beach Condos"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium">
                  Min Stories
                </label>
                <input
                  type="number"
                  value={stories}
                  onChange={(e) => setStories(Number(e.target.value))}
                  min={1}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">
                  Coast Distance (mi)
                </label>
                <input
                  type="number"
                  value={coastDistance}
                  onChange={(e) => setCoastDistance(Number(e.target.value))}
                  min={0}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {drawnBounds && (
              <p className="text-xs text-gray-500">
                Bounds: {drawnBounds.south.toFixed(4)}N to{" "}
                {drawnBounds.north.toFixed(4)}N, {drawnBounds.west.toFixed(4)}W
                to {drawnBounds.east.toFixed(4)}W
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSubmitRegion}
                disabled={submitting || !regionName.trim()}
                className="flex-1 rounded bg-blue-600 py-2 text-sm font-semibold hover:bg-blue-500 transition disabled:opacity-50"
              >
                {submitting ? "Creating..." : "Create Region"}
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 rounded bg-gray-800 py-2 text-sm hover:bg-gray-700 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
