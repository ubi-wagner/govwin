'use client';

import { useState } from 'react';
import { Atomizer } from './atomizer';
import { AtomLibrary } from './atom-library';
import { PackageAtomizer } from './package-atomizer';
import { CaptureAtomizer } from './capture-atomizer';

type Tab = 'library' | 'package' | 'atomize' | 'capture';
const LABELS: Record<Tab, string> = { library: 'Library', package: 'Upload package', atomize: 'Atomize', capture: 'Capture' };

/** Tabbed home for the atom library: browse · bulk-atomize a package · hand-shred · capture from screen. */
export function AtomsWorkbench({ tenantSlug }: { tenantSlug: string }) {
  const [tab, setTab] = useState<Tab>('library');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200 text-sm">
        {(['library', 'package', 'atomize', 'capture'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 font-medium border-b-2 ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {LABELS[t]}
          </button>
        ))}
      </div>
      {tab === 'library' && <AtomLibrary tenantSlug={tenantSlug} />}
      {tab === 'package' && <PackageAtomizer tenantSlug={tenantSlug} onDone={() => { /* atoms landed; Library tab reloads on mount */ }} />}
      {tab === 'atomize' && <Atomizer tenantSlug={tenantSlug} />}
      {tab === 'capture' && <CaptureAtomizer tenantSlug={tenantSlug} />}
    </div>
  );
}
