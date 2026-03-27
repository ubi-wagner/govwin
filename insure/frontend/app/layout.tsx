import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Insure — Hunt-Kill-Cook",
  description: "Florida insurance lead generation and triage",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
