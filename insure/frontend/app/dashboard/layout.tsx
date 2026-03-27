"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const token = Cookies.get("insure_auth");
    if (token !== "authenticated") {
      router.replace("/login");
    } else {
      setAuthed(true);
    }
  }, [router]);

  function handleLogout() {
    Cookies.remove("insure_auth");
    router.replace("/login");
  }

  if (!authed) return null;

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-3">
        <h1 className="text-lg font-bold tracking-tight">
          Insure — Hunt-Kill-Cook
        </h1>
        <nav className="flex items-center gap-4 text-sm">
          <a href="/dashboard" className="hover:text-blue-400 transition">
            Map
          </a>
          <a href="/dashboard/pipeline" className="hover:text-blue-400 transition">
            Pipeline
          </a>
          <button
            onClick={handleLogout}
            className="rounded bg-gray-800 px-3 py-1 hover:bg-gray-700 transition"
          >
            Logout
          </button>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
