/**
 * Custom vector diagrams for the marketing arc — hand-drawn SVG, no icon fonts,
 * no emoji. Colors come from Tailwind text/fill utilities (currentColor), so they
 * track the brand palette.
 */

/** Expert + AI + Process converging on "Win" — a three-lobe Venn. Light background. */
export function ModelDiagram({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 330" className={className} fill="none" role="img" aria-label="Expert plus AI plus Process equals Win">
      {/* lobes */}
      <circle cx="180" cy="125" r="92" className="text-brand-500" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.07" />
      <circle cx="130" cy="200" r="92" className="text-citrus" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.07" />
      <circle cx="230" cy="200" r="92" className="text-award" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.07" />
      {/* labels */}
      <text x="180" y="44" textAnchor="middle" className="fill-navy-800" style={{ fontFamily: 'var(--font-display, inherit)' }} fontSize="19" fontWeight={800}>Expert</text>
      <text x="66" y="288" textAnchor="middle" className="fill-navy-800" style={{ fontFamily: 'var(--font-display, inherit)' }} fontSize="19" fontWeight={800}>AI</text>
      <text x="294" y="288" textAnchor="middle" className="fill-navy-800" style={{ fontFamily: 'var(--font-display, inherit)' }} fontSize="19" fontWeight={800}>Process</text>
      <text x="180" y="170" textAnchor="middle" className="fill-brand-600" fontStyle="italic" fontSize="24" fontWeight={700}>Win</text>
    </svg>
  );
}

/** Flywheel ring with three drawn arrowheads showing the cycle direction. */
export function FlywheelRing({ className = '' }: { className?: string }) {
  // One arrowhead at the top of the ring, tangent (pointing clockwise), rotated 120°/240°.
  const arrow = 'M 162 47 L 178 42 L 170 58 Z';
  return (
    <svg viewBox="0 0 340 280" className={className} fill="none" role="img" aria-label="A compounding flywheel">
      <circle cx="170" cy="140" r="95" className="text-brand-200" stroke="currentColor" strokeWidth="3" />
      <g className="text-brand-500" fill="currentColor">
        <path d={arrow} />
        <path d={arrow} transform="rotate(120 170 140)" />
        <path d={arrow} transform="rotate(240 170 140)" />
      </g>
      {/* node dots */}
      <g className="text-brand-500" fill="currentColor">
        <circle cx="170" cy="45" r="5" />
        <circle cx="252" cy="187" r="5" />
        <circle cx="88" cy="187" r="5" />
      </g>
      <text x="170" y="135" textAnchor="middle" className="fill-navy-700" style={{ fontFamily: 'var(--font-display, inherit)' }} fontSize="15" fontWeight={800}>Every cycle</text>
      <text x="170" y="156" textAnchor="middle" className="fill-navy-500" fontSize="12">cheaper · faster · better</text>
    </svg>
  );
}
