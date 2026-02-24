# SAM.gov Opportunities API v2 — Cheatsheet

> Reference for the GovWin pipeline team. Based on the official [GSA Open Technology documentation](https://open.gsa.gov/api/get-opportunities-public-api/).

## Endpoints

| Env        | Base URL                                           |
|------------|---------------------------------------------------|
| Production | `https://api.sam.gov/prod/opportunities/v2/search` |
| Alpha      | `https://api-alpha.sam.gov/prodlike/opportunities/v2/search` |

## Authentication

- API key via query parameter: `?api_key=YOUR_KEY`
- Register at [sam.gov](https://sam.gov/) → System Account → API Key
- **Public access**: 10 requests/day
- **Registered entity**: 1,000 requests/day
- Key expires every ~90 days — rotate proactively

## Query Parameters

| Parameter       | Type   | Description                                           | Example                |
|----------------|--------|-------------------------------------------------------|------------------------|
| `api_key`      | string | **Required.** Your API key                            | `abc123...`            |
| `limit`        | int    | Results per page (max 1000, default 10)               | `25`                   |
| `offset`       | int    | Pagination offset                                     | `0`                    |
| `postedFrom`   | string | Posted date start (MM/DD/YYYY)                        | `02/01/2026`           |
| `postedTo`     | string | Posted date end (MM/DD/YYYY)                          | `02/24/2026`           |
| `ptype`        | string | Notice types (comma-separated)                        | `o,k,p`                |
| `solnum`       | string | Solicitation number                                   | `47QTCA-24-R-0089`     |
| `noticeid`     | string | Specific notice ID                                    | `a3b4c5d6e7f8g9h0...` |
| `title`        | string | Keyword search in title                               | `cloud migration`      |
| `deptname`     | string | Department name filter                                | `DEPT OF DEFENSE`      |
| `subtier`      | string | Sub-tier agency filter                                | `DEFENSE INFO...`      |
| `ncode`        | string | NAICS code filter                                     | `541512`               |
| `ccode`        | string | Classification code filter                            | `D302`                 |
| `typeOfSetAside` | string | Set-aside code                                      | `SDVOSBA`              |
| `status`       | string | Active status filter                                  | `active`               |

## Notice Types (`ptype` values)

| Code | Full Name in Response            | Our `opportunity_type` |
|------|----------------------------------|----------------------|
| `o`  | `"Solicitation"`                | `solicitation`       |
| `p`  | `"Presolicitation"`             | `presolicitation`    |
| `k`  | `"Sources Sought"`              | `sources_sought`     |
| `r`  | `"Combined Synopsis/Solicitation"` | `solicitation`    |
| `s`  | `"Special Notice"`              | `special_notice`     |
| `i`  | `"Intent to Bundle Requirements"` | `intent_bundle`    |
| `a`  | `"Award Notice"`                | `award`              |
| `u`  | `"Justification and Approval"` | `justification`      |

> **Our pipeline uses**: `ptype=o,k,p` (solicitations, sources sought, presolicitations)

## Response Structure

```json
{
  "totalRecords": 847,
  "limit": 25,
  "offset": 0,
  "opportunitiesData": [
    { /* opportunity object */ },
    ...
  ]
}
```

## Opportunity Object Fields

### Core Identification
| SAM.gov Field          | Type    | Our DB Column           | Notes                                          |
|-----------------------|---------|------------------------|-------------------------------------------------|
| `noticeId`            | string  | `source_id`            | Unique ID, 32-char hex. Used in URL.            |
| `title`               | string  | `title`                | Max ~500 chars                                  |
| `solicitationNumber`  | string  | `solicitation_number`  | Format varies: `HC1028-24-R-0042`, `W911QY-...` |
| `type`                | string  | `opportunity_type`     | Full name. Mapped to our enum.                  |
| `baseType`            | string  | *(not stored)*         | Base notice type before amendments               |
| `active`              | string  | `status`               | `"Yes"` → `active`, `"No"` → `closed`          |

### Agency / Organization
| SAM.gov Field          | Type   | Our DB Column  | Notes                                          |
|-----------------------|--------|---------------|-------------------------------------------------|
| `department`          | string | *(in agency)* | Top-level department                             |
| `subTier`             | string | *(in agency)* | Sub-tier agency                                  |
| `office`              | string | *(in agency)* | Office name                                      |
| `fullParentPathName`  | string | `agency`      | **Dot-separated hierarchy**. We store this full. |
| `fullParentPathCode`  | string | `agency_code` | We extract the first segment (top-level code).   |
| `organizationType`    | string | *(not stored)* | e.g., `"OFFICE"`                                |

> **Example**: `"DEPT OF DEFENSE.DEFENSE INFORMATION SYSTEMS AGENCY.DISA PL8"` with code `"097.DISA.PL8"`. We store `agency_code = "097"`.

### Dates
| SAM.gov Field    | Type        | Our DB Column  | Format                                    |
|-----------------|-------------|---------------|-------------------------------------------|
| `postedDate`    | string      | `posted_date`  | `YYYY-MM-DD` (date only)                  |
| `responseDeadLine` | string/null | `close_date` | ISO 8601: `2026-03-21T17:00:00-05:00`    |
| `archiveDate`   | string/null | *(fallback)*  | `YYYY-MM-DD`. Used as close_date fallback. |
| `archiveType`   | string      | *(not stored)* | `"manual"`, `"auto15"`, `"auto30"`, `"autocustom"` |

> **Date parsing**: Our ingester tries `%Y-%m-%dT%H:%M:%S%z`, then `%m/%d/%Y`, then `%Y-%m-%d`.

### Classification
| SAM.gov Field                | Type        | Our DB Column       | Notes                                        |
|-----------------------------|-------------|--------------------|-------------------------------------------------|
| `naicsCode`                 | string/null | `naics_codes[0]`   | Single NAICS code as string (e.g., `"541512"`)  |
| `classificationCode`        | string/null | *(not stored)*     | PSC code (e.g., `"D302"`)                       |
| `typeOfSetAside`            | string/null | `set_aside_code`   | Short code: `"SBA"`, `"SDVOSBA"`, `"8A"`, etc. |
| `typeOfSetAsideDescription` | string/null | `set_aside_type`   | Full description                                |

### Set-Aside Codes (common values)
| `typeOfSetAside` | `typeOfSetAsideDescription`                                    | Our Scoring Match       |
|-----------------|---------------------------------------------------------------|------------------------|
| `SBA`           | `Total Small Business Set-Aside` / `Small Business Set-Aside` | `is_small_business`    |
| `SDVOSBA`       | `Service-Disabled Veteran-Owned Small Business (SDVOSB)`      | `is_sdvosb`            |
| `WOSB`          | `Women-Owned Small Business`                                  | `is_wosb`              |
| `HZC`           | `HUBZone Set-Aside`                                           | `is_hubzone`           |
| `8A`            | `8(a) Set-Aside`                                              | `is_8a`                |
| `8AN`           | `8(a) Sole Source`                                             | `is_8a`                |
| `VSA`           | `Veteran-Owned Small Business Set-Aside`                      | `is_sdvosb` (partial)  |
| `ISBEE`         | `Indian Small Business Economic Enterprise Set-Aside`         | *(not scored)*         |
| *(null)*        | *(null)*                                                       | Full & open competition |

### Award Information (when `type` = `"Award Notice"`)
| SAM.gov Field               | Type   | Our DB Column    | Notes                           |
|----------------------------|--------|------------------|---------------------------------|
| `award.date`               | string | *(not stored)*   | Award date                      |
| `award.number`             | string | `contract_number`| Contract/award number           |
| `award.amount`             | string | *(not stored)*   | Dollar amount as string         |
| `award.awardee.name`       | string | *(not stored)*   | Winner name                     |
| `award.awardee.ueiSAM`    | string | *(not stored)*   | Winner's UEI                    |
| `award.awardee.location`   | object | *(not stored)*   | City, state, zip, country       |

### Contacts
| SAM.gov Field                  | Type  | Our DB Column  | Notes                                |
|-------------------------------|-------|---------------|--------------------------------------|
| `pointOfContact`              | array | `raw_data`    | Array of contact objects              |
| `pointOfContact[].type`       | string| -             | `"primary"` or `"secondary"`         |
| `pointOfContact[].fullName`   | string| -             | Contact name                          |
| `pointOfContact[].email`      | string| -             | Contact email                         |
| `pointOfContact[].phone`      | string| -             | Contact phone                         |

### Links & Documents
| SAM.gov Field      | Type        | Our DB Column    | Notes                                 |
|-------------------|-------------|-----------------|---------------------------------------|
| `description`     | string/obj  | `description`   | Can be text body or API URL for fetch  |
| `uiLink`          | string      | `source_url`    | Public link: `https://sam.gov/opp/...` |
| `additionalInfoLink` | string/null | *(not stored)* | Extra info link                       |
| `resourceLinks`   | array/null  | `document_urls` | Attached documents for download        |
| `links`           | array       | *(not stored)*  | HATEOAS links                          |

## NAICS Codes (Common for GovTech)

| NAICS  | Description                                   |
|--------|-----------------------------------------------|
| 541512 | Computer Systems Design Services              |
| 541511 | Custom Computer Programming Services          |
| 541519 | Other Computer Related Services               |
| 541513 | Computer Facilities Management Services       |
| 518210 | Computing Infrastructure Providers / Cloud    |
| 541611 | Admin Management Consulting                   |
| 541618 | Other Management Consulting                   |
| 541612 | Human Resources Consulting                    |
| 611430 | Professional Development Training             |
| 541690 | Other Scientific and Technical Consulting     |
| 561210 | Facilities Support Services                   |
| 541330 | Engineering Services                          |

## Content Hash Deduplication

Our ingester computes a SHA-256 hash of the raw JSON response (sorted keys) and stores the first 16 chars as `content_hash`. On re-fetch:
- **Same hash** → skip (unchanged)
- **Different hash** → UPDATE opportunity + INSERT amendment record

## Our Cron Schedule (pipeline_schedules)

| Schedule            | Source        | Cron           | Priority | Description                                   |
|--------------------|---------------|----------------|----------|-----------------------------------------------|
| SAM.gov Daily      | `sam_gov`     | `0 6 * * *`    | 1        | Full ingest: fetch all posted last 7 days      |
| Grants.gov Daily   | `grants_gov`  | `0 6 * * *`    | 2        | Full ingest from grants.gov API                |
| SBIR Weekly        | `sbir`        | `0 7 * * 1`    | 3        | Weekly SBIR/STTR opportunity pull              |
| USASpending Intel  | `usaspending` | `0 8 * * 0`    | 4        | Weekly award intelligence for pipeline context |
| Open Opp Refresh   | `refresh`     | `0 */4 * * *`  | 2        | Re-check active opps for close date changes    |
| Re-score Tenants   | `scoring`     | `0 5 * * *`    | 3        | Score all active opps for all tenants          |
| Email Digests      | `digest`      | `0 7 * * *`    | 5        | Send daily digest emails to tenants            |

## Common API Queries

### 1. Daily Full Ingest (last 7 days)
```
GET /prod/opportunities/v2/search
  ?api_key=KEY
  &postedFrom=02/17/2026
  &postedTo=02/24/2026
  &limit=25
  &offset=0
  &ptype=o,k,p
```

### 2. Specific Opportunity by Notice ID
```
GET /prod/opportunities/v2/search
  ?api_key=KEY
  &noticeid=a3b4c5d6e7f8g9h0i1j2k3l4
```

### 3. NAICS-Filtered Search
```
GET /prod/opportunities/v2/search
  ?api_key=KEY
  &ncode=541512
  &postedFrom=01/01/2026
  &postedTo=02/24/2026
  &limit=100
  &offset=0
  &ptype=o,k,p
```

### 4. Set-Aside Specific (SDVOSB only)
```
GET /prod/opportunities/v2/search
  ?api_key=KEY
  &typeOfSetAside=SDVOSBA
  &postedFrom=02/01/2026
  &postedTo=02/24/2026
  &limit=25
  &ptype=o,k,p
```

### 5. Refresh Active Opportunities (check for amendments)
```
GET /prod/opportunities/v2/search
  ?api_key=KEY
  &status=active
  &limit=100
  &offset=0
  &ptype=o,k,p
```

## Rate Limit Strategy

```
Daily budget: 1,000 requests
Pages per ingest: ~40 (1,000 active opps / 25 per page)
Refresh cycles: 6 per day (every 4 hours)
Reserve for on-demand: 100 requests

Daily usage estimate:
  Morning full ingest:    40 requests
  6x refresh cycles:    240 requests (40 each)
  Reserve:              100 requests
  Total:               ~380 requests (38% of budget)
```

## Field Mapping: SAM.gov → Our Pipeline → Frontend

```
SAM.gov API                    →  opportunities table        →  tenant_pipeline VIEW      →  React component
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
noticeId                       →  source_id                  →  source_id                  →  (internal)
title                          →  title                      →  title                      →  opp.title
description.body               →  description                →  description                →  opp.description
fullParentPathName             →  agency                     →  agency                     →  opp.agency
fullParentPathCode (segment 1) →  agency_code                →  agency_code                →  (filter/scoring)
naicsCode                      →  naics_codes[]              →  naics_codes[]              →  opp.naicsCodes
typeOfSetAsideDescription      →  set_aside_type             →  set_aside_type             →  opp.setAsideType
typeOfSetAside                 →  set_aside_code             →  (in raw_data)              →  (scoring only)
type (mapped)                  →  opportunity_type            →  opportunity_type            →  opp.opportunityType
postedDate                     →  posted_date                →  posted_date                →  opp.postedDate
responseDeadLine               →  close_date                 →  close_date                 →  opp.closeDate
solicitationNumber             →  solicitation_number        →  solicitation_number        →  opp.solicitationNumber
uiLink                         →  source_url                 →  source_url                 →  opp.sourceUrl → <a> link
(whole response)               →  raw_data (JSONB)           →  (not in view)              →  (debugging only)
(computed by hash)             →  content_hash               →  (not in view)              →  (dedup internal)
```

## Important Gotchas

1. **`description` can be a URL or text**: When fetching via search, the description field often contains a URL to fetch the full description. Our ingester handles both: if it's a dict with `body`, extract it; otherwise treat as text.

2. **Date format inconsistency**: `postedDate` is `YYYY-MM-DD`, but `responseDeadLine` is ISO 8601 with timezone. Our parser tries multiple formats.

3. **`naicsCode` is singular**: SAM.gov returns a single NAICS code per opportunity, not an array. We store in `naics_codes TEXT[]` for future multi-NAICS support.

4. **`type` field is human-readable**: SAM.gov returns `"Solicitation"`, not `"o"`. The `ptype` query param uses the short code (`o,k,p`), but the response uses the full name.

5. **No single-opportunity endpoint**: There is no `/v2/{id}` endpoint. To fetch one opportunity, use `?noticeid=ID`.

6. **`award.amount` is a string**: Dollar values come as strings (e.g., `"350567.00"`). Parse to numeric.

7. **Pagination**: Use `totalRecords` to determine if more pages exist. If `offset + limit < totalRecords`, fetch next page.

8. **JSONB keys in Postgres are snake_case**: The `get_system_status()` function returns JSONB with snake_case keys (`pipeline_jobs`, `failed_24h`). The postgres.js `toCamel` transform only converts column names, NOT keys inside JSONB. API routes must manually transform these.
