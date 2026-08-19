/** Define the SEVEN DSIP volumes for OSW26BZ04-DP013 exactly as the R4 announcement lists them. */
import { sqlBypass as sql } from '@/lib/db';
const SOL = process.argv[2] ?? '11263a74-ab09-48bb-ada5-565aa2ee986e';
const VOLS: Array<[number,string,string,string[]]> = [
  [1,'Proposal Cover Sheet','dsip_standard','Created as part of the DoW Proposal Submissions process in DSIP. Phase I Base cost must be identified here and in Volume 3.'.split('|')],
  [2,'Technical Volume','dsip_standard',['NOT TO EXCEED 10 PAGES — T3CP evaluates only the first ten (10) pages; additional pages are not evaluated.','Format per DoW SBIR Program BAA "Format of Technical Volume (Volume 2)".','Required items per the BAA "Content of the Technical Volume 2".','Must describe: selected DoW patent(s) + associated DoW laboratory; sector area; product/prototype concept; commercial and/or defense end use; technical modifications to adapt the invention; anticipated performance improvements or commercial value; CEL status or plan; logistics/safety/regulatory impacts; transition approach.']],
  [3,'Cost Volume','dsip_standard',['Phase I Base amount must NOT exceed $250,000.00.','Use the DSIP online cost volume.','TABA (up to $6,500) is in addition to the ceiling and is requested via Volume 5.']],
  [4,'Company Commercialization Report (CCR)','dsip_standard',['Completion of the CCR in Volume 4 of the DSIP submission is required.']],
  [5,'Supporting Documents','dsip_standard',['TABA Request Form (if TABA requested) — must use the SBIR/STTR TABA Request Form.','D2P2 only: summary of Phase I-equivalent work performed, NOT TO EXCEED 3 pages.','Foreign Affiliations form accepted here as PDF only per the R4 instruction; do not upload previous versions.']],
  [6,'Fraud, Waste and Abuse Training','dsip_standard',['FWA training material is found in the Volume 6 section of the DSIP proposal submission.']],
  [7,'Disclosures of Foreign Affiliations or Relationships to Foreign Countries','dsip_standard',['Completed via the Volume 7 webform in the DSIP proposal submission.']],
];
for (const [n,name,fmt,reqs] of VOLS) {
  await sql`INSERT INTO solicitation_volumes (solicitation_id, volume_number, volume_name, volume_format, special_requirements, description)
            VALUES (${SOL}::uuid, ${n}, ${name}, ${fmt}, ${reqs}, ${'OSW26BZ04-DP013 T3CP Patent Holiday — Volume ' + n})
            ON CONFLICT DO NOTHING`;
}
const rows = await sql`SELECT volume_number, volume_name, volume_format FROM solicitation_volumes WHERE solicitation_id=${SOL}::uuid ORDER BY volume_number`;
for (const r of rows as any[]) console.log(`  V${r.volumeNumber} ${r.volumeName} [${r.volumeFormat}]`);
console.log(`✓ ${rows.length} volumes defined`);
await sql.end();
