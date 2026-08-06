/**
 * In-page guide on the EconDev partner landing page (/partner): how to create + manage a stable
 * of client companies and build proposals for them. Static server component; collapsible via native
 * <details> (no client JS). See docs/ECONDEV_PARTNER_ADMIN.md + docs/TVSF_PAUL_TWO_ROLE_GUIDE.md.
 */

const card: React.CSSProperties = {
  border: '1px solid #e5e5e5', borderRadius: 10, padding: '14px 18px', marginTop: 16, background: '#fbfcfe',
};
const h3: React.CSSProperties = { fontSize: 15, margin: '14px 0 6px', color: '#1a4a8a' };
const li: React.CSSProperties = { margin: '3px 0', lineHeight: 1.5 };
const note: React.CSSProperties = { fontSize: 13, color: '#555', margin: '4px 0' };
const kbd: React.CSSProperties = { background: '#eef2f8', border: '1px solid #d5deea', borderRadius: 4, padding: '1px 6px', fontSize: 12, fontWeight: 600 };

export default function PartnerGuide() {
  return (
    <details style={card}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15, color: '#1a4a8a' }}>
        How this works — creating &amp; managing your companies
      </summary>

      <p style={{ ...note, marginTop: 10 }}>
        This page is <b>your stable</b>. Every company you create here belongs to you, is provisioned
        instantly (spotlight buckets + the live federal/state opportunity pipeline + a starter library),
        and carries <b>no checkout or paywall</b>. You — and only you — see your companies; no other
        partner or customer can.
      </p>

      <h3 style={h3}>1 · Create a company</h3>
      <ol style={{ margin: '4px 0', paddingLeft: 22 }}>
        <li style={li}>Click <span style={kbd}>+ New company</span>.</li>
        <li style={li}>Enter the company name. Optionally add a <b>founder POC</b> email + name (or leave it blank and staff it later).</li>
        <li style={li}>Click <span style={kbd}>Create company</span> — it appears in your list below, already provisioned with buckets, the opportunity pipeline, and a starter library.</li>
      </ol>
      <p style={note}>Behind the scenes it becomes your owned tenant, you&rsquo;re added as its admin, and the opportunity cards are scored against its buckets — all automatically.</p>

      <h3 style={h3}>2 · Staff the company</h3>
      <ul style={{ margin: '4px 0', paddingLeft: 22 }}>
        <li style={li}>Add a founder POC at create time (they get their own login), <b>or</b></li>
        <li style={li}>Open the workspace and invite the founders/team from inside the company&rsquo;s portal — each teammate gets scoped access you control.</li>
      </ul>

      <h3 style={h3}>3 · Open the workspace &amp; build a proposal</h3>
      <ol style={{ margin: '4px 0', paddingLeft: 22 }}>
        <li style={li}>Click <span style={kbd}>Open workspace →</span> on a company.</li>
        <li style={li}>Review its <b>ranked opportunity pipeline</b> — spotlight buckets score each SBIR/STTR/state opportunity by fit.</li>
        <li style={li}>Pick an opportunity → open its proposal portal (comp — no charge) → the build provisions with the <b>compliance matrix + section molds</b>.</li>
        <li style={li}>Run the <b>doorbell (Proposal Auto-Drive)</b> — the 3-stage, color-team-reviewed build: <b>Draft → Refine → Compliance</b>. At each gate you <b>comment + regenerate</b> or <b>approve → next</b>, or run all three automatically.</li>
        <li style={li}>When the compliance gate clears, <b>advance</b> and <b>download</b> the proposal (Word / PDF / per-volume ZIP).</li>
      </ol>
      <p style={note}>For a TVSF build, the matrix already encodes the EC/DMVEC rules section-by-section (external §1, the pro-forma years + TVSF row, the $200k / 20%-personnel / no-cost-share budget, the native Risk &amp; Project-Plan tables) — see the TVSF guide.</p>

      <h3 style={h3}>4 · Recycle into the library</h3>
      <p style={note}>Locked sections atomize back into that company&rsquo;s library — reusable, taxonomy-tagged content that feeds its next SBIR/grant draft. The more the company builds, the stronger its library gets.</p>

      <h3 style={h3}>5 · What stays yours</h3>
      <p style={note}>Each company&rsquo;s data is private to it and to you. Your stable is isolated from every other EconDev partner and every direct customer on the platform — you never see theirs, they never see yours.</p>
    </details>
  );
}
