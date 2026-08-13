import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/lib/toast';

export const metadata: Metadata = {
  // Template: any page/layout that sets a string title renders "<title> · RFP Pipeline";
  // pages with no title fall back to the default. Fixes every tab reading "RFP Pipeline".
  title: { default: 'RFP Pipeline', template: '%s · RFP Pipeline' },
  description: 'AI-powered proposal management for government contractors',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
