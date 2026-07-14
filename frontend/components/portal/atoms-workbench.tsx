'use client';

import { useState } from 'react';
import { Atomizer } from './atomizer';
import { AtomLibrary } from './atom-library';

/** Tabbed home for the atom library: browse/compose vs hand-shred new atoms. */
export function AtomsWorkbench({ tenantSlug }: { tenantSlug: string }) {
  const [tab, setTab] = useState<'library' | 'atomize'>('library');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200 text-sm">
        {(['library', 'atomize'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 font-medium capitalize border-b-2 ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'atomize' ? 'Atomize' : 'Library'}
          </button>
        ))}
      </div>
      {tab === 'library' ? <AtomLibrary tenantSlug={tenantSlug} /> : <Atomizer tenantSlug={tenantSlug} />}
    </div>
  );
}
