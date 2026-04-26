import { createHash } from 'crypto';
import { sql } from '@/lib/db';

function parseBool(val: string | undefined): boolean {
  if (!val) return false;
  const v = val.trim().toUpperCase();
  return v === 'Y' || v === 'YES' || v === 'TRUE' || v === '1';
}

function parseDate(val: string | undefined): string | null {
  if (!val || !val.trim()) return null;
  const d = new Date(val.trim());
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseNum(val: string | undefined): number | null {
  if (!val || !val.trim()) return null;
  const n = parseFloat(val.trim().replace(/[$,]/g, ''));
  return isNaN(n) ? null : n;
}

function parseInt2(val: string | undefined): number | null {
  if (!val || !val.trim()) return null;
  const n = parseInt(val.trim().replace(/,/g, ''), 10);
  return isNaN(n) ? null : n;
}

function trimOrNull(val: string | undefined): string | null {
  if (!val) return null;
  const t = val.trim();
  return t === '' ? null : t;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  const len = line.length;
  while (i <= len) {
    if (i === len) { fields.push(''); break; }
    if (line[i] === '"') {
      let value = '';
      i++;
      while (i < len) {
        if (line[i] === '"') {
          if (i + 1 < len && line[i + 1] === '"') { value += '"'; i += 2; }
          else { i++; break; }
        } else { value += line[i]; i++; }
      }
      fields.push(value);
      if (i < len && line[i] === ',') i++;
    } else {
      const nextComma = line.indexOf(',', i);
      if (nextComma === -1) { fields.push(line.substring(i)); break; }
      else { fields.push(line.substring(i, nextComma)); i = nextComma + 1; }
    }
  }
  return fields;
}

function* splitLines(text: string): Generator<string> {
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      const end = i > 0 && text[i - 1] === '\r' ? i - 1 : i;
      yield text.substring(start, end);
      start = i + 1;
    }
  }
  if (start < text.length) {
    yield text[text.length - 1] === '\r' ? text.substring(start, text.length - 1) : text.substring(start);
  }
}

const COMPANY_HEADER_MAP: Record<string, string> = {
  'company name': 'company_name', 'uei': 'uei', 'duns': 'duns',
  'address 1': 'address1', 'address1': 'address1', 'address 2': 'address2', 'address2': 'address2',
  'city': 'city', 'state': 'state', 'zip': 'zip', 'country': 'country',
  'company url': 'company_url', 'hubzone owned': 'hubzone_owned',
  'woman owned': 'woman_owned', 'disadvantaged': 'disadvantaged',
  'socially economically disadvantaged': 'disadvantaged',
  'number awards': 'number_awards',
};

const AWARD_HEADER_MAP: Record<string, string> = {
  'company': 'company_name', 'company name': 'company_name',
  'award title': 'award_title', 'agency': 'agency', 'branch': 'branch',
  'phase': 'phase', 'program': 'program',
  'agency tracking number': 'agency_tracking_number', 'contract': 'contract',
  'proposal award date': 'proposal_award_date', 'contract end date': 'contract_end_date',
  'solicitation number': 'solicitation_number', 'solicitation year': 'solicitation_year',
  'solicitation close date': 'solicitation_close_date',
  'proposal receipt date': 'proposal_receipt_date',
  'date of notification': 'date_of_notification', 'topic code': 'topic_code',
  'award year': 'award_year', 'award amount': 'award_amount',
  'uei': 'uei', 'duns': 'duns',
  'hubzone owned': 'hubzone_owned', 'disadvantaged': 'disadvantaged',
  'socially and economically disadvantaged': 'disadvantaged',
  'woman owned': 'woman_owned', 'number employees': 'number_employees',
  'company website': 'company_website',
  'address 1': 'address1', 'address1': 'address1', 'address 2': 'address2', 'address2': 'address2',
  'city': 'city', 'state': 'state', 'zip': 'zip',
  'abstract': 'abstract', 'contact name': 'contact_name', 'contact title': 'contact_title',
  'contact phone': 'contact_phone', 'contact email': 'contact_email',
  'pi name': 'pi_name', 'pi title': 'pi_title', 'pi phone': 'pi_phone', 'pi email': 'pi_email',
  'ri name': 'ri_name', 'ri poc name': 'ri_poc_name', 'ri poc phone': 'ri_poc_phone',
};

interface RawRow { [dbCol: string]: string }
const BATCH_SIZE = 500;

async function insertCompanyBatch(rows: RawRow[]): Promise<void> {
  if (rows.length === 0) return;
  const placeholders: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  let idx = 1;
  for (const row of rows) {
    placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
    params.push(
      trimOrNull(row.company_name) ?? '', trimOrNull(row.uei), trimOrNull(row.duns),
      trimOrNull(row.address1), trimOrNull(row.address2), trimOrNull(row.city),
      trimOrNull(row.state), trimOrNull(row.zip), trimOrNull(row.country),
      trimOrNull(row.company_url), parseBool(row.hubzone_owned),
      parseBool(row.woman_owned), parseBool(row.disadvantaged),
    );
  }
  await sql.unsafe(
    `INSERT INTO sbir_companies (company_name,uei,duns,address1,address2,city,state,zip,country,company_url,hubzone_owned,woman_owned,disadvantaged)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (uei) WHERE uei IS NOT NULL AND uei != '' DO UPDATE SET
       company_name=EXCLUDED.company_name, duns=COALESCE(EXCLUDED.duns,sbir_companies.duns),
       address1=COALESCE(EXCLUDED.address1,sbir_companies.address1), city=COALESCE(EXCLUDED.city,sbir_companies.city),
       state=COALESCE(EXCLUDED.state,sbir_companies.state), zip=COALESCE(EXCLUDED.zip,sbir_companies.zip),
       company_url=COALESCE(EXCLUDED.company_url,sbir_companies.company_url),
       hubzone_owned=EXCLUDED.hubzone_owned, woman_owned=EXCLUDED.woman_owned, disadvantaged=EXCLUDED.disadvantaged, updated_at=now()`,
    params,
  );
}

async function insertAwardBatch(rows: RawRow[]): Promise<void> {
  if (rows.length === 0) return;
  const placeholders: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  let idx = 1;
  for (const row of rows) {
    const v = {
      company_name: trimOrNull(row.company_name) ?? '', award_title: trimOrNull(row.award_title),
      agency: trimOrNull(row.agency), branch: trimOrNull(row.branch), phase: trimOrNull(row.phase),
      program: trimOrNull(row.program), agency_tracking_number: trimOrNull(row.agency_tracking_number),
      contract: trimOrNull(row.contract), proposal_award_date: parseDate(row.proposal_award_date),
      contract_end_date: parseDate(row.contract_end_date), solicitation_number: trimOrNull(row.solicitation_number),
      solicitation_year: trimOrNull(row.solicitation_year), solicitation_close_date: parseDate(row.solicitation_close_date),
      proposal_receipt_date: parseDate(row.proposal_receipt_date), date_of_notification: parseDate(row.date_of_notification),
      topic_code: trimOrNull(row.topic_code), award_year: trimOrNull(row.award_year),
      award_amount: parseNum(row.award_amount), uei: trimOrNull(row.uei), duns: trimOrNull(row.duns),
      hubzone_owned: parseBool(row.hubzone_owned), disadvantaged: parseBool(row.disadvantaged),
      woman_owned: parseBool(row.woman_owned), number_employees: parseInt2(row.number_employees),
      company_website: trimOrNull(row.company_website), address1: trimOrNull(row.address1),
      address2: trimOrNull(row.address2), city: trimOrNull(row.city), state: trimOrNull(row.state),
      zip: trimOrNull(row.zip), abstract: trimOrNull(row.abstract), contact_name: trimOrNull(row.contact_name),
      contact_title: trimOrNull(row.contact_title), contact_phone: trimOrNull(row.contact_phone),
      contact_email: trimOrNull(row.contact_email), pi_name: trimOrNull(row.pi_name),
      pi_title: trimOrNull(row.pi_title), pi_phone: trimOrNull(row.pi_phone), pi_email: trimOrNull(row.pi_email),
      ri_name: trimOrNull(row.ri_name), ri_poc_name: trimOrNull(row.ri_poc_name), ri_poc_phone: trimOrNull(row.ri_poc_phone),
    };
    const cols = 42;
    placeholders.push(`(${Array.from({ length: cols }, (_, j) => `$${idx + j}`).join(',')})`);
    params.push(
      v.company_name, v.award_title, v.agency, v.branch, v.phase, v.program,
      v.agency_tracking_number, v.contract, v.proposal_award_date, v.contract_end_date,
      v.solicitation_number, v.solicitation_year, v.solicitation_close_date, v.proposal_receipt_date,
      v.date_of_notification, v.topic_code, v.award_year, v.award_amount, v.uei, v.duns,
      v.hubzone_owned, v.disadvantaged, v.woman_owned, v.number_employees, v.company_website,
      v.address1, v.address2, v.city, v.state, v.zip, v.abstract, v.contact_name,
      v.contact_title, v.contact_phone, v.contact_email, v.pi_name, v.pi_title, v.pi_phone,
      v.pi_email, v.ri_name, v.ri_poc_name, v.ri_poc_phone,
    );
    idx += cols;
  }
  await sql.unsafe(
    `INSERT INTO sbir_awards (company_name,award_title,agency,branch,phase,program,agency_tracking_number,contract,
      proposal_award_date,contract_end_date,solicitation_number,solicitation_year,solicitation_close_date,
      proposal_receipt_date,date_of_notification,topic_code,award_year,award_amount,uei,duns,
      hubzone_owned,disadvantaged,woman_owned,number_employees,company_website,
      address1,address2,city,state,zip,abstract,contact_name,contact_title,contact_phone,contact_email,
      pi_name,pi_title,pi_phone,pi_email,ri_name,ri_poc_name,ri_poc_phone)
     VALUES ${placeholders.join(',')}`,
    params,
  );
}

export interface IngestResult {
  fileType: 'company' | 'award';
  rowCount: number;
  filename: string;
  isDuplicate: boolean;
}

/**
 * Detect if a CSV buffer contains SBIR data and ingest it.
 * Returns null if the file is not an SBIR CSV.
 */
export async function detectAndIngestSbirCsv(
  buffer: Buffer,
  filename: string,
  userId: string,
  storageKey?: string,
): Promise<IngestResult | null> {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext !== 'csv') return null;

  const fileText = buffer.toString('utf-8');
  const lines = splitLines(fileText);
  const headerResult = lines.next();
  if (headerResult.done || !headerResult.value.trim()) return null;

  const rawHeaders = parseCSVLine(headerResult.value);
  const headersLower = rawHeaders.map(h => h.trim().toLowerCase());

  const hasAwardTitle = headersLower.some(h => h === 'award title');
  const hasAwardAmount = headersLower.some(h => h === 'award amount');
  const hasNumberAwards = headersLower.some(h => h === 'number awards');

  let fileType: 'company' | 'award';
  let headerMap: Record<string, string>;

  if (hasAwardTitle || hasAwardAmount) {
    fileType = 'award';
    headerMap = AWARD_HEADER_MAP;
  } else if (hasNumberAwards) {
    fileType = 'company';
    headerMap = COMPANY_HEADER_MAP;
  } else {
    return null;
  }

  const fileHash = createHash('sha256').update(buffer).digest('hex');
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM sbir_data_uploads WHERE file_hash = ${fileHash} LIMIT 1
  `;
  if (existing) {
    return { fileType, rowCount: 0, filename, isDuplicate: true };
  }

  const colMapping: { index: number; dbCol: string }[] = [];
  for (let i = 0; i < headersLower.length; i++) {
    const mapped = headerMap[headersLower[i]];
    if (mapped) colMapping.push({ index: i, dbCol: mapped });
  }

  let rowCount = 0;
  let batch: RawRow[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = parseCSVLine(line);
    const row: RawRow = {};
    for (const { index, dbCol } of colMapping) row[dbCol] = fields[index] ?? '';
    if (!trimOrNull(row.company_name)) continue;

    batch.push(row);
    rowCount++;

    if (batch.length >= BATCH_SIZE) {
      if (fileType === 'company') await insertCompanyBatch(batch);
      else await insertAwardBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    if (fileType === 'company') await insertCompanyBatch(batch);
    else await insertAwardBatch(batch);
  }

  await sql`
    INSERT INTO sbir_data_uploads (filename, file_hash, file_type, row_count, uploaded_by, storage_key)
    VALUES (${filename}, ${fileHash}, ${fileType}, ${rowCount}, ${userId}::uuid, ${storageKey ?? null})
  `;

  return { fileType, rowCount, filename, isDuplicate: false };
}
