/**
 * In-page guide on the partner-manager console (/partner): the higher-order org + a stable of
 * client companies, the add-company precheck + branches, the manager handshake, and descend/ascend.
 * Static server component; collapsible via native <details> (no client JS).
 * See docs/PARTNER_MANAGER_DESIGN.md + docs/TVSF_PAUL_TWO_ROLE_GUIDE.md.
 */

const card: React.CSSProperties = {
  border: '1px solid #e5e5e5', borderRadius: 10, padding: '14px 18px', marginTop: 16, marginBottom: 16, background: '#fbfcfe',
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
        This is your <b>console</b>. Up top is <b>your organization</b> (a full workspace of its own —
        run your buckets, the opportunity pipeline, and apply for grants as your org). Below is your
        <b> stable</b>: one card per client company you created or manage, with live stats. You — and
        only you — see your stable; no other partner or customer can.
      </p>

      <h3 style={h3}>1 · Your organization</h3>
      <p style={note}>
        Click <span style={kbd}>Open my org workspace →</span> to work inside your own org exactly like
        a company: ranked opportunities, buckets, library, and proposal builds. This is where you
        pursue grants as an organization.
      </p>

      <h3 style={h3}>2 · Add a company</h3>
      <ol style={{ margin: '4px 0', paddingLeft: 22 }}>
        <li style={li}>Click <span style={kbd}>+ Add a company</span> and enter the company name, admin name, and admin email.</li>
        <li style={li}>We <b>check for an existing company</b> first (by name), then route you:</li>
      </ol>
      <ul style={{ margin: '2px 0 4px', paddingLeft: 22 }}>
        <li style={li}><b>New company</b> → a short onboarding form (phone, description, your notes) → <span style={kbd}>Submit for approval</span>. An RFP Pipeline admin reviews and approves it; once approved it lands in your stable, fully provisioned (buckets + pipeline + starter library) and owned by you — <b>no checkout</b>.</li>
        <li style={li}><b>Already on the platform</b> → you can&rsquo;t register it twice. Click <span style={kbd}>Request manager access</span> — the company&rsquo;s admin gets a to-do and approves, and it joins your stable.</li>
        <li style={li}><b>Similar name</b> → we show the close matches so you can confirm it&rsquo;s genuinely new (audited) or pick the existing one.</li>
      </ul>
      <p style={note}>The admin email must be unique as a company owner — but the same person can still be a collaborator at another company.</p>

      <h3 style={h3}>3 · Manage a company (descend &amp; return)</h3>
      <ol style={{ margin: '4px 0', paddingLeft: 22 }}>
        <li style={li}>Click <span style={kbd}>Open workspace →</span> on a company card — you enter its portal <b>as its manager</b> (full admin), with a <b>&ldquo;Managing … — Exit to partner console&rdquo;</b> banner up top.</li>
        <li style={li}>Work inside it: staff the team, review the ranked pipeline, build proposals.</li>
        <li style={li}>Click <span style={kbd}>Exit to partner console →</span> to come back up. Hop straight between your companies — no re-login.</li>
      </ol>

      <h3 style={h3}>4 · Build a proposal</h3>
      <ol style={{ margin: '4px 0', paddingLeft: 22 }}>
        <li style={li}>Inside a company, pick an opportunity → open its proposal portal (comp — no charge) → the build provisions with the <b>compliance matrix + section molds</b>.</li>
        <li style={li}>Run the <b>doorbell (Proposal Auto-Drive)</b> — the 3-stage, color-team-reviewed build: <b>Draft → Refine → Compliance</b>. At each gate <b>comment + regenerate</b> or <b>approve → next</b>, or run all three automatically.</li>
        <li style={li}>When the compliance gate clears, <b>advance</b> and <b>download</b> (Word / PDF / per-volume ZIP). Locked sections atomize back into that company&rsquo;s library for its next draft.</li>
      </ol>
      <p style={note}>For a TVSF build, the matrix already encodes the EC/DMVEC rules section-by-section — see the TVSF guide.</p>

      <h3 style={h3}>5 · Being added by a company</h3>
      <p style={note}>A company can also add you directly: their admin invites your email as a <b>Manager</b> from their Team page, which grants you the same manager access — no request needed.</p>

      <h3 style={h3}>6 · What stays yours</h3>
      <p style={note}>Each company&rsquo;s data is private to it and to you. Your stable is isolated from every other partner and every direct customer — you never see theirs, they never see yours.</p>
    </details>
  );
}
