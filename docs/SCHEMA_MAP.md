# Schema map — generated from the live database

> **⚠ ROW COUNTS AND "% populated" DESCRIBE THE DATABASE THIS WAS GENERATED AGAINST**,
> not the product. A column reading 0% means nothing in THAT database populates it — which on
> a sandbox rebuilt by a drive is a statement about the drive, not about the code. Treat them as a
> strong hint about FK DIRECTION and a weak one about anything else. The STRUCTURE — tables,
> columns, types, constraints, foreign keys — is exact.
>
> **DO NOT EDIT.** Regenerate: `source scripts/sandbox-env.sh && node scripts/schema-map.mjs`
> Run it after every migration. A hand-maintained copy of a schema that changes weekly
> becomes wrong silently — which is exactly what happened to CLAUDE_CLIFFNOTES §1, frozen at
> migration 067 while the body grew to 202.

**Generated against** migration head `243_contacts.sql` · **137 tables** · 1884 columns · 309 foreign keys

## How to use this before writing SQL

| If you are about to… | Read |
|---|---|
| name a column | §2 Tables |
| compare a status/type/stage to a literal | **§3 Vocabularies** — a value not listed does not exist |
| join two tables | **§4 Links** — check which DIRECTION is actually written |
| query anything tenant-scoped | §5 Isolation |

---

## 1. Six mistakes this map exists to prevent

All made in a single session, each costing a full ingest→shred→curate cycle to rediscover.
Only two are "column does not exist" — which is why a plain column list is not enough.

| Assumption | Reality | Caught by |
|---|---|---|
| `opportunities.status` | no such column (`topic_status`) | §2 |
| `tenant_opportunity_cards.status` | `lifecycle_status` / `pursuit_status` | §2 |
| `proposal_sections.status = 'locked'` | vocabulary is `ai_drafted\|approved\|in_progress`; locking is `locked_at` | **§3** |
| join on `opportunities.solicitation_id` | written the other way (`curated_solicitations.opportunity_id`) — B46 | **§4** |
| `system_events.type = 'finder.rfp.x'` | `namespace` and `type` are separate columns | §2 + §3 |
| package JSON at top level | envelope is `{ data: … }` | not schema — API contract |

---

## 2. Tables

### `_migration_history`  · 243 rows

| column | type | null | default |
|---|---|---|---|
| `filename` | text | **no** |  |
| `applied_at` | timestamp with time zone | **no** | `now()` |
| `checksum` | text | yes |  |

### `accounts`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `user_id` | uuid | **no** |  |
| `type` | text | **no** |  |
| `provider` | text | **no** |  |
| `provider_account_id` | text | **no** |  |
| `refresh_token` | text | yes |  |
| `access_token` | text | yes |  |
| `expires_at` | bigint | yes |  |
| `token_type` | text | yes |  |
| `scope` | text | yes |  |
| `id_token` | text | yes |  |

### `agent_performance`  · 20 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `agent_role` | text | **no** |  |
| `period_start` | date | **no** |  |
| `period_end` | date | **no** |  |
| `tasks_completed` | integer | yes | `0` |
| `acceptance_rate` | double precision | yes |  |
| `avg_edit_pct` | double precision | yes |  |
| `avg_cost_usd` | numeric | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `agent_task_log`  · 481 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | yes |  |
| `agent_role` | text | **no** |  |
| `task_type` | text | **no** |  |
| `trigger_event` | text | yes |  |
| `proposal_id` | uuid | yes |  |
| `section_id` | uuid | yes |  |
| `input_tokens` | integer | yes |  |
| `output_tokens` | integer | yes |  |
| `tool_calls_count` | integer | yes | `0` |
| `duration_ms` | integer | yes |  |
| `cost_usd` | numeric | yes |  |
| `human_accepted` | boolean | yes |  |
| `human_edit_pct` | double precision | yes |  |
| `memories_retrieved` | integer | yes | `0` |
| `memories_written` | integer | yes | `0` |
| `error` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `status` | text | yes |  |
| `started_at` | timestamp with time zone | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `guardrail_decision` | text | yes |  |

### `agent_task_queue`  · 10 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `agent_role` | text | **no** |  |
| `task_type` | text | **no** |  |
| `input` | jsonb | **no** |  |
| `proposal_id` | uuid | yes |  |
| `section_id` | uuid | yes |  |
| `status` | text | **no** | `'pending'::text` |
| `worker_id` | text | yes |  |
| `picked_at` | timestamp with time zone | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `error` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `scope_level` | text | yes |  |
| `scope_ref` | jsonb | yes |  |

- CHECK `agent_task_queue_scope_level_check`: `CHECK (((scope_level IS NULL) OR (scope_level = ANY (ARRAY['node'::text, 'group'::text, 'section'::text, 'pages'::text, 'document'::text]))))`
- CHECK `agent_task_queue_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text])))`

### `agent_task_results`  · 10 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `task_id` | uuid | **no** |  |
| `output` | jsonb | **no** |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `api_key_registry`  · 4 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `source` | text | **no** |  |
| `encrypted_key` | text | yes |  |
| `key_hint` | text | yes |  |
| `expires_at` | timestamp with time zone | yes |  |
| `last_validated` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `applications`  · 1 rows · _tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `contact_email` | text | **no** |  |
| `contact_name` | text | **no** |  |
| `contact_title` | text | yes |  |
| `contact_phone` | text | yes |  |
| `company_name` | text | **no** |  |
| `company_website` | text | yes |  |
| `company_size` | text | yes |  |
| `company_state` | text | yes |  |
| `sam_registered` | boolean | yes |  |
| `sam_cage_code` | text | yes |  |
| `duns_uei` | text | yes |  |
| `previous_submissions` | integer | yes |  |
| `previous_awards` | integer | yes |  |
| `previous_award_programs` | ARRAY | yes |  |
| `tech_summary` | text | **no** |  |
| `tech_areas` | ARRAY | **no** | `'{}'::text[]` |
| `target_programs` | ARRAY | **no** | `'{}'::text[]` |
| `target_agencies` | ARRAY | **no** | `'{}'::text[]` |
| `desired_outcomes` | ARRAY | **no** | `'{}'::text[]` |
| `motivation` | text | yes |  |
| `referral_source` | text | yes |  |
| `status` | text | **no** | `'pending'::text` |
| `reviewed_by` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `review_notes` | text | yes |  |
| `accepted_cohort` | text | yes |  |
| `terms_accepted_at` | timestamp with time zone | **no** |  |
| `terms_version` | text | **no** | `'v1'::text` |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `ip_hash` | text | yes |  |
| `user_agent` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `source` | text | **no** | `'public'::text` |
| `session_id` | text | yes |  |
| `tenant_id` | uuid | yes |  |
| `contact_id` | uuid | yes |  |

- CHECK `applications_source_check`: `CHECK ((source = ANY (ARRAY['public'::text, 'partner'::text])))`
- CHECK `applications_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'accepted'::text, 'rejected'::text, 'onboarded'::text, 'withdrawn'::text])))`

### `atom_embeddings`  · 1,102 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `atom_id` | uuid | **no** |  |
| `tenant_id` | uuid | **no** |  |
| `model` | text | **no** |  |
| `dim` | integer | **no** |  |
| `content_hash` | text | **no** |  |
| `embedding` | USER-DEFINED | **no** |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `atom_lineage`  · 0 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `parent_atom_id` | uuid | **no** |  |
| `child_atom_id` | uuid | **no** |  |
| `relation` | text | **no** | `'derived_from'::text` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `atom_lineage_check`: `CHECK ((parent_atom_id <> child_atom_id))`
- CHECK `atom_lineage_relation_check`: `CHECK ((relation = ANY (ARRAY['derived_from'::text, 'reused_from'::text])))`

### `atom_members`  · 1,300 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `group_atom_id` | uuid | **no** |  |
| `member_atom_id` | uuid | **no** |  |
| `ordinal` | integer | **no** | `0` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `atom_members_check`: `CHECK ((group_atom_id <> member_atom_id))`

### `atom_tags`  · 10,978 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `atom_id` | uuid | **no** |  |
| `dimension` | text | **no** |  |
| `value` | text | **no** |  |
| `is_other` | boolean | **no** | `false` |
| `tag_source` | text | **no** | `'admin'::text` |
| `confirmed` | boolean | **no** | `false` |
| `confirmed_by` | uuid | yes |  |
| `confirmed_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `atom_tags_tag_source_check`: `CHECK ((tag_source = ANY (ARRAY['auto'::text, 'admin'::text])))`

### `automation_framework`  · 1 rows

| column | type | null | default |
|---|---|---|---|
| `id` | integer | **no** | `1` |
| `curation_sla_minutes` | integer | **no** | `4320` |
| `default_nudge_days` | ARRAY | **no** | `'{1,3}'::integer[]` |
| `default_due_in_minutes` | integer | **no** | `4320` |
| `max_buckets_per_tenant` | integer | **no** | `25` |
| `max_nudges_per_gate` | integer | **no** | `3` |
| `agent_monthly_budget_ceiling_usd` | numeric | **no** | `200.00` |
| `agent_auto_run_default` | boolean | **no** | `false` |
| `agent_settings` | jsonb | **no** | `'{}'::jsonb` |
| `overlay_frameworks` | jsonb | **no** | `'[]'::jsonb` |
| `updated_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `automation_framework_id_check`: `CHECK ((id = 1))`

### `automation_log`  · 32 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `rule_id` | uuid | yes |  |
| `trigger_event_id` | uuid | yes |  |
| `action_taken` | text | yes |  |
| `result` | jsonb | yes | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `action_type` | text | **no** | `''::text` |
| `status` | text | **no** | `'success'::text` |
| `error_message` | text | yes |  |
| `executed_at` | timestamp with time zone | **no** | `now()` |

- CHECK `automation_log_status_check`: `CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'skipped'::text, 'deferred'::text, 'error'::text])))`

### `automation_rules`  · 17 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `name` | text | **no** |  |
| `conditions` | jsonb | yes | `'{}'::jsonb` |
| `action_type` | text | **no** |  |
| `action_config` | jsonb | yes | `'{}'::jsonb` |
| `cooldown_minutes` | integer | yes | `0` |
| `max_fires_per_hour` | integer | yes | `100` |
| `enabled` | boolean | **no** | `true` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `description` | text | yes |  |
| `is_active` | boolean | **no** | `true` |
| `trigger_namespace` | text | **no** | `''::text` |
| `trigger_type` | text | **no** | `''::text` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `automation_rules_action_type_check`: `CHECK ((action_type = ANY (ARRAY['log_only'::text, 'queue_notification'::text, 'queue_job'::text, 'emit_event'::text, 'send_email'::text, 'notify_admin'::text, `

### `canvas_versions`  · 12 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `section_id` | uuid | **no** |  |
| `version_number` | integer | **no** |  |
| `content` | jsonb | **no** |  |
| `snapshot_reason` | text | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `source` | text | **no** | `'human_edit'::text` |
| `ai_instruction` | text | yes |  |
| `ai_model` | text | yes |  |
| `parent_version_id` | uuid | yes |  |
| `char_count` | integer | yes |  |
| `word_count` | integer | yes |  |
| `edit_summary` | text | yes |  |

- CHECK `canvas_versions_source_check`: `CHECK ((source = ANY (ARRAY['ai_draft'::text, 'human_edit'::text, 'ai_revision'::text, 'library_import'::text, 'template'::text, 'system'::text])))`

### `cms_content`  · 130 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `slug` | text | **no** |  |
| `title` | text | **no** |  |
| `content_type` | text | **no** |  |
| `body` | text | **no** |  |
| `excerpt` | text | yes |  |
| `author` | text | yes |  |
| `tags` | ARRAY | yes | `'{}'::text[]` |
| `published` | boolean | **no** | `false` |
| `published_at` | timestamp with time zone | yes |  |
| `featured_image` | text | yes |  |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `external_url` | text | yes |  |
| `display_order` | integer | yes | `0` |
| `status` | text | **no** | `'draft'::text` |

- CHECK `cms_content_content_type_check`: `CHECK ((content_type = ANY (ARRAY['blog_post'::text, 'resource'::text, 'guide'::text, 'announcement'::text, 'faq'::text, 'testimonial'::text, 'team_member'::tex`
- CHECK `cms_content_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'published'::text, 'private'::text, 'archived'::text])))`

### `collaboration_vaults`  · 2 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `partner_name` | text | **no** |  |
| `partner_org` | text | yes |  |
| `status` | text | **no** | `'active'::text` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `closed_at` | timestamp with time zone | yes |  |

- CHECK `collaboration_vaults_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text])))`

### `collaborator_stage_access`  · 26 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `collaborator_id` | uuid | **no** |  |
| `proposal_id` | uuid | **no** |  |
| `stage` | text | **no** |  |
| `artifact_types` | ARRAY | yes | `'{}'::text[]` |
| `permission` | text | **no** | `'view'::text` |
| `access_granted_at` | timestamp with time zone | **no** | `now()` |
| `access_revoked_at` | timestamp with time zone | yes |  |
| `granted_by` | uuid | yes |  |

- CHECK `collaborator_stage_access_permission_check`: `CHECK ((permission = ANY (ARRAY['view'::text, 'comment'::text, 'edit'::text])))`

### `command_seen_state`  · 6 rows

| column | type | null | default |
|---|---|---|---|
| `user_id` | uuid | **no** |  |
| `scope` | text | **no** |  |
| `tab` | text | **no** |  |
| `last_seen_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `compliance_presets`  · 6 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `name` | text | **no** |  |
| `phase_type` | text | **no** |  |
| `agency` | text | yes |  |
| `program_type` | text | yes |  |
| `compliance_data` | jsonb | **no** | `'{}'::jsonb` |
| `volumes_data` | jsonb | **no** | `'[]'::jsonb` |
| `is_system` | boolean | yes | `false` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | yes | `now()` |

### `compliance_variables`  · 25 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `name` | text | **no** |  |
| `label` | text | **no** |  |
| `category` | text | **no** |  |
| `data_type` | text | **no** | `'text'::text` |
| `options` | jsonb | yes |  |
| `is_system` | boolean | **no** | `true` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `compliance_variables_data_type_check`: `CHECK ((data_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'select'::text, 'multiselect'::text])))`

### `consent_records`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `user_id` | uuid | **no** |  |
| `document_type` | text | **no** |  |
| `document_version` | text | **no** |  |
| `accepted_at` | timestamp with time zone | **no** | `now()` |
| `ip_address` | text | yes |  |

### `contacts`  · 1 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `email` | text | **no** |  |
| `name` | text | yes |  |
| `company_name` | text | yes |  |
| `first_session_id` | text | yes |  |
| `first_seen_at` | timestamp with time zone | **no** | `now()` |
| `source` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `content_pages`  · 76 rows · _archivable_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `page_key` | text | **no** |  |
| `content_type` | text | **no** | `'page'::text` |
| `version_no` | integer | **no** | `1` |
| `status` | text | **no** | `'draft'::text` |
| `title` | text | yes |  |
| `blocks` | jsonb | **no** | `'[]'::jsonb` |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `audit_note` | text | yes |  |
| `created_by` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `published_at` | timestamp with time zone | yes |  |
| `archived_at` | timestamp with time zone | yes |  |

- CHECK `content_pages_content_type_check`: `CHECK ((content_type = ANY (ARRAY['page'::text, 'blog_post'::text, 'resource'::text, 'guide'::text, 'testimonial'::text, 'team_member'::text])))`
- CHECK `content_pages_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))`

### `contracts`  · 2 rows · _RLS on · tenant-scoped · archivable_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `opportunity_id` | uuid | **no** |  |
| `proposal_id` | uuid | yes |  |
| `title` | text | **no** |  |
| `status` | text | **no** | `'active'::text` |
| `award_date` | timestamp with time zone | yes | `now()` |
| `award_amount_cents` | bigint | yes |  |
| `pop_start` | date | yes |  |
| `pop_end` | date | yes |  |
| `origin_card` | jsonb | **no** | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `archived_at` | timestamp with time zone | yes |  |

- CHECK `contracts_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'terminated'::text])))`

### `curated_solicitations`  · 36 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `opportunity_id` | uuid | **no** |  |
| `namespace` | text | **no** |  |
| `status` | text | **no** | `'new'::text` |
| `claimed_by` | uuid | yes |  |
| `claimed_at` | timestamp with time zone | yes |  |
| `curated_by` | uuid | yes |  |
| `approved_by` | uuid | yes |  |
| `pushed_at` | timestamp with time zone | yes |  |
| `dismissed_reason` | text | yes |  |
| `phase_like` | text | yes |  |
| `ai_extracted` | jsonb | yes |  |
| `ai_confidence` | double precision | yes |  |
| `ai_similar_to` | uuid | yes |  |
| `ai_similarity_score` | double precision | yes |  |
| `full_text` | text | yes |  |
| `full_text_tsv` | tsvector | yes |  |
| `annotations` | jsonb | yes | `'[]'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `review_requested_for` | uuid | yes |  |
| `solicitation_type` | text | yes | `'single'::text` |
| `solicitation_title` | text | yes |  |
| `solicitation_number` | text | yes |  |
| `round_number` | integer | yes |  |
| `round_label` | text | yes |  |
| `intake_meta` | jsonb | **no** | `'{}'::jsonb` |
| `spotlight_summary` | text | yes |  |
| `build_complete` | boolean | **no** | `false` |
| `build_completed_at` | timestamp with time zone | yes |  |
| `build_completed_by` | uuid | yes |  |
| `ingest_phase` | text | **no** | `'not_started'::text` |

- CHECK `curated_solicitations_ingest_phase_check`: `CHECK ((ingest_phase = ANY (ARRAY['not_started'::text, 'extract'::text, 'matrix'::text, 'review'::text, 'landed'::text, 'molds'::text, 'complete'::text])))`
- CHECK `curated_solicitations_phase_like_check`: `CHECK ((phase_like = ANY (ARRAY['phase_1'::text, 'phase_2'::text])))`
- CHECK `curated_solicitations_solicitation_type_check`: `CHECK ((solicitation_type = ANY (ARRAY['single'::text, 'multi_topic'::text])))`
- CHECK `curated_solicitations_status_check`: `CHECK ((status = ANY (ARRAY['new'::text, 'claimed'::text, 'released'::text, 'released_for_analysis'::text, 'ai_analyzed'::text, 'shredder_failed'::text, 'curati`

### `curation_notes`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `author_id` | uuid | yes |  |
| `author_email` | text | yes |  |
| `body` | text | **no** |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `curation_notes_body_check`: `CHECK (((length(body) >= 1) AND (length(body) <= 4000)))`

### `curation_revisions`  · 115 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `actor_id` | uuid | yes |  |
| `actor_email` | text | yes |  |
| `revision_type` | text | **no** |  |
| `field_name` | text | yes |  |
| `old_value` | text | yes |  |
| `new_value` | text | yes |  |
| `metadata` | jsonb | yes | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `curation_revisions_revision_type_check`: `CHECK ((revision_type = ANY (ARRAY['compliance_updated'::text, 'annotation_added'::text, 'annotation_removed'::text, 'outline_updated'::text, 'volume_added'::te`

### `deploy_baseline`  · 2 rows

| column | type | null | default |
|---|---|---|---|
| `id` | text | **no** |  |
| `note` | text | yes |  |
| `recorded_at` | timestamp with time zone | **no** | `now()` |

### `document_cocoons`  · 8 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | yes |  |
| `name` | text | **no** |  |
| `program_type` | text | yes |  |
| `scope` | text | **no** | `'section'::text` |
| `structure` | jsonb | **no** | `'{}'::jsonb` |
| `origin_proposal_id` | uuid | yes |  |
| `source` | text | **no** | `'system'::text` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `origin_document_id` | uuid | yes |  |

- CHECK `document_cocoons_scope_check`: `CHECK ((scope = ANY (ARRAY['section'::text, 'document'::text])))`
- CHECK `document_cocoons_source_check`: `CHECK ((source = ANY (ARRAY['upload'::text, 'download'::text, 'system'::text, 'harvest'::text])))`

### `document_templates`  · 9 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `name` | text | **no** |  |
| `description` | text | yes |  |
| `template_type` | text | **no** |  |
| `agency` | text | yes |  |
| `program_type` | text | yes |  |
| `storage_key` | text | yes |  |
| `canvas_preset` | jsonb | **no** |  |
| `node_count` | integer | yes | `0` |
| `is_system` | boolean | **no** | `false` |
| `tenant_id` | uuid | yes |  |
| `created_by` | uuid | yes |  |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `canvas_document` | jsonb | **no** | `'{}'::jsonb` |

- CHECK `document_templates_template_type_check`: `CHECK ((template_type = ANY (ARRAY['technical_volume'::text, 'cost_volume'::text, 'slide_deck'::text, 'past_performance'::text, 'key_personnel'::text, 'commerci`

### `email_send_ledger`  · 21 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `correlation_id` | uuid | **no** |  |
| `idempotency_key` | text | **no** |  |
| `tenant_id` | uuid | yes |  |
| `provider` | text | **no** |  |
| `provider_message_id` | text | yes |  |
| `kind` | text | **no** |  |
| `status` | text | **no** | `'pending'::text` |
| `to_email` | text | **no** |  |
| `subject` | text | yes |  |
| `template` | text | yes |  |
| `error` | text | yes |  |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `sent_at` | timestamp with time zone | yes |  |

- CHECK `email_send_ledger_kind_check`: `CHECK ((kind = ANY (ARRAY['transactional'::text, 'correspondence'::text])))`
- CHECK `email_send_ledger_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'suppressed'::text])))`

### `email_suppressions`  · 0 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `email` | text | **no** |  |
| `reason` | text | **no** |  |
| `source` | text | **no** |  |
| `detail` | jsonb | **no** | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `email_suppressions_email_check`: `CHECK ((email = lower(email)))`
- CHECK `email_suppressions_reason_check`: `CHECK ((reason = ANY (ARRAY['hard_bounce'::text, 'spam_complaint'::text, 'manual'::text])))`
- CHECK `email_suppressions_source_check`: `CHECK ((source = ANY (ARRAY['postmark_webhook'::text, 'operator'::text])))`

### `episodic_memories`  · 585 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | yes |  |
| `agent_role` | text | **no** |  |
| `embedding` | USER-DEFINED | **no** |  |
| `content` | text | **no** |  |
| `memory_type` | text | **no** | `'observation'::text` |
| `importance` | double precision | **no** | `0.5` |
| `entities` | jsonb | yes | `'[]'::jsonb` |
| `metadata` | jsonb | yes | `'{}'::jsonb` |
| `source` | text | yes |  |
| `occurred_at` | timestamp with time zone | **no** | `now()` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `last_accessed` | timestamp with time zone | **no** | `now()` |
| `access_count` | integer | **no** | `0` |
| `decay_factor` | double precision | **no** | `1.0` |
| `is_archived` | boolean | **no** | `false` |
| `superseded_by` | uuid | yes |  |
| `namespace` | text | yes |  |

- CHECK `episodic_memories_memory_type_check`: `CHECK ((memory_type = ANY (ARRAY['observation'::text, 'interaction'::text, 'decision'::text, 'outcome'::text])))`

### `expert_availability_blocks`  · 1 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `admin_user_id` | uuid | **no** |  |
| `start_at` | timestamp with time zone | **no** |  |
| `end_at` | timestamp with time zone | **no** |  |
| `status` | text | **no** | `'open'::text` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `eab_window_valid`: `CHECK ((end_at > start_at))`
- CHECK `expert_availability_blocks_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'booked'::text, 'cancelled'::text])))`

### `expert_time_bookings`  · 1 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `block_id` | uuid | **no** |  |
| `booked_by_user_id` | uuid | **no** |  |
| `admin_user_id` | uuid | **no** |  |
| `start_at` | timestamp with time zone | **no** |  |
| `end_at` | timestamp with time zone | **no** |  |
| `minutes` | integer | **no** |  |
| `status` | text | **no** | `'booked'::text` |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `expert_time_bookings_minutes_check`: `CHECK ((minutes > 0))`
- CHECK `expert_time_bookings_status_check`: `CHECK ((status = ANY (ARRAY['booked'::text, 'cancelled'::text])))`

### `guardrail_templates`  · 1 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | yes |  |
| `name` | text | **no** |  |
| `description` | text | yes |  |
| `config` | jsonb | **no** | `'{}'::jsonb` |
| `is_default` | boolean | **no** | `false` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `library_atoms`  · 1,662 rows · _RLS FORCED · tenant-scoped · archivable_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `grain` | text | **no** | `'primitive'::text` |
| `title` | text | yes |  |
| `content` | text | yes |  |
| `canvas_nodes` | jsonb | yes |  |
| `summary` | text | yes |  |
| `word_count` | integer | **no** | `0` |
| `char_count` | integer | **no** | `0` |
| `member_summary` | jsonb | **no** | `'{}'::jsonb` |
| `status` | text | **no** | `'draft'::text` |
| `confidence` | real | **no** | `0.5` |
| `outcome` | text | **no** | `'pending'::text` |
| `outcome_score` | real | **no** | `0.5` |
| `usage_count` | integer | **no** | `0` |
| `source` | text | **no** | `'upload'::text` |
| `cocoon_id` | uuid | yes |  |
| `origin_proposal_id` | uuid | yes |  |
| `origin_section_id` | uuid | yes |  |
| `embedding` | USER-DEFINED | yes |  |
| `owner_user_id` | uuid | yes |  |
| `visibility` | text | **no** | `'tenant'::text` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `creator_kind` | text | **no** | `'admin'::text` |
| `created_by` | uuid | yes |  |
| `source_anchor` | jsonb | yes |  |
| `vault_id` | uuid | yes |  |
| `archived_at` | timestamp with time zone | yes |  |
| `corpus_verbatim` | boolean | **no** | `false` |

- CHECK `library_atoms_creator_kind_check`: `CHECK ((creator_kind = ANY (ARRAY['admin'::text, 'ai'::text, 'collaborator'::text, 'system'::text, 'import'::text])))`
- CHECK `library_atoms_grain_check`: `CHECK ((grain = ANY (ARRAY['foundation'::text, 'section'::text, 'group'::text, 'primitive'::text, 'reference'::text])))`
- CHECK `library_atoms_outcome_check`: `CHECK ((outcome = ANY (ARRAY['pending'::text, 'awarded'::text, 'rejected'::text, 'withdrawn'::text])))`
- CHECK `library_atoms_source_check`: `CHECK ((source = ANY (ARRAY['upload'::text, 'harvest'::text, 'download_derivative'::text, 'manual'::text])))`
- CHECK `library_atoms_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'archived'::text])))`
- CHECK `library_atoms_visibility_check`: `CHECK ((visibility = ANY (ARRAY['tenant'::text, 'owner_only'::text, 'shared_for_proposal'::text, 'admin_only'::text, 'vault'::text])))`

### `library_seed_jobs`  · 4 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `proposal_id` | uuid | **no** |  |
| `status` | text | **no** | `'analyzing'::text` |
| `candidate_proposals` | jsonb | **no** | `'[]'::jsonb` |
| `source_proposal_id` | uuid | yes |  |
| `section_mapping` | jsonb | **no** | `'{}'::jsonb` |
| `section_decisions` | jsonb | **no** | `'{}'::jsonb` |
| `error_message` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `library_seed_jobs_status_check`: `CHECK ((status = ANY (ARRAY['analyzing'::text, 'awaiting_selection'::text, 'mapping'::text, 'awaiting_review'::text, 'applied'::text, 'skipped'::text])))`

### `master_templates`  · 39 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `template_key` | text | **no** |  |
| `title` | text | **no** |  |
| `category` | text | **no** |  |
| `agency` | text | yes |  |
| `format` | text | **no** | `'document'::text` |
| `canvas_document` | jsonb | **no** |  |
| `version` | integer | **no** | `1` |
| `status` | text | **no** | `'active'::text` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `master_templates_format_check`: `CHECK ((format = ANY (ARRAY['document'::text, 'deck'::text, 'spreadsheet'::text])))`
- CHECK `master_templates_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'deprecated'::text])))`

### `notification_read_state`  · 1 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `user_id` | uuid | **no** |  |
| `tenant_id` | uuid | **no** |  |
| `last_read_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `opportunities`  · 106 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `source` | text | **no** |  |
| `source_id` | text | **no** |  |
| `title` | text | **no** |  |
| `agency` | text | yes |  |
| `office` | text | yes |  |
| `solicitation_number` | text | yes |  |
| `naics_codes` | ARRAY | yes | `'{}'::text[]` |
| `classification_code` | text | yes |  |
| `set_aside_type` | text | yes |  |
| `program_type` | text | yes |  |
| `close_date` | timestamp with time zone | yes |  |
| `posted_date` | timestamp with time zone | yes |  |
| `estimated_value_min` | numeric | yes |  |
| `estimated_value_max` | numeric | yes |  |
| `description` | text | yes |  |
| `content_hash` | text | yes |  |
| `full_text_tsv` | tsvector | yes |  |
| `award_date` | timestamp with time zone | yes |  |
| `award_amount` | numeric | yes |  |
| `awardee` | text | yes |  |
| `is_active` | boolean | **no** | `true` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `solicitation_id` | uuid | yes |  |
| `topic_number` | text | yes |  |
| `topic_branch` | text | yes |  |
| `topic_status` | text | yes | `'open'::text` |
| `tech_focus_areas` | ARRAY | **no** | `'{}'::text[]` |
| `poc_name` | text | yes |  |
| `poc_email` | text | yes |  |
| `topic_metadata` | jsonb | **no** | `'{}'::jsonb` |
| `phase_type` | text | yes |  |
| `lifecycle_status` | text | **no** | `'open'::text` |
| `closed_at` | timestamp with time zone | yes |  |
| `closed_reason` | text | yes |  |
| `reopened_at` | timestamp with time zone | yes |  |
| `close_date_changed_at` | timestamp with time zone | yes |  |
| `previous_close_date` | timestamp with time zone | yes |  |
| `submission_stage` | text | **no** | `'open'::text` |
| `open_date` | timestamp with time zone | yes |  |
| `pre_release_date` | timestamp with time zone | yes |  |
| `org_unit` | text | yes |  |
| `expert_notes` | text | yes |  |
| `built_by` | uuid | yes |  |
| `released_by` | uuid | yes |  |
| `released_at` | timestamp with time zone | yes |  |
| `origin_document_id` | uuid | yes |  |
| `dates_estimated` | boolean | **no** | `false` |
| `update_watch` | boolean | **no** | `false` |
| `update_watch_at` | timestamp with time zone | yes |  |
| `update_watch_by` | uuid | yes |  |
| `field_basis` | jsonb | **no** | `'{}'::jsonb` |

- CHECK `opportunities_lifecycle_status_check`: `CHECK ((lifecycle_status = ANY (ARRAY['open'::text, 'closed'::text, 'archived'::text])))`
- CHECK `opportunities_phase_type_check`: `CHECK ((phase_type = ANY (ARRAY['phase_1'::text, 'phase_2'::text, 'direct_to_phase_2'::text, 'phase_3'::text, 'cso'::text, 'ota'::text, 'baa'::text, 'other'::te`
- CHECK `opportunities_submission_stage_check`: `CHECK ((submission_stage = ANY (ARRAY['nofo'::text, 'pre_release'::text, 'open'::text, 'updated'::text, 'closed'::text, 'archived'::text])))`
- CHECK `opportunities_topic_status_check`: `CHECK ((topic_status = ANY (ARRAY['open'::text, 'pre_release'::text, 'closed'::text, 'awarded'::text, 'withdrawn'::text])))`

### `opportunity_bridge`  · 559 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `opportunity_id` | uuid | **no** |  |
| `version` | integer | **no** |  |
| `event_type` | text | **no** |  |
| `card` | jsonb | **no** |  |
| `posted_by` | uuid | yes |  |
| `posted_at` | timestamp with time zone | **no** | `now()` |

- CHECK `opportunity_bridge_event_type_check`: `CHECK ((event_type = ANY (ARRAY['published'::text, 'updated'::text, 'closed'::text, 'reopened'::text, 'awarded'::text, 'archived'::text])))`

### `opportunity_lifecycle_actions`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `opportunity_id` | uuid | **no** |  |
| `actor_id` | uuid | yes |  |
| `action` | text | **no** |  |
| `from_status` | text | yes |  |
| `to_status` | text | yes |  |
| `reason` | text | yes |  |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `opportunity_lifecycle_actions_action_check`: `CHECK ((action = ANY (ARRAY['close'::text, 'reopen'::text, 'archive'::text, 'close_date_change'::text, 'set_stage'::text])))`

### `page_views`  · 257 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `session_id` | text | **no** |  |
| `page_path` | text | **no** |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `duration_ms` | integer | yes |  |
| `referrer` | text | yes |  |
| `utm_source` | text | yes |  |
| `utm_medium` | text | yes |  |
| `utm_campaign` | text | yes |  |

### `pipeline_jobs`  · 15 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `source` | text | **no** |  |
| `run_type` | text | **no** | `'full'::text` |
| `status` | text | **no** | `'pending'::text` |
| `worker_id` | text | yes |  |
| `result` | jsonb | yes |  |
| `error` | text | yes |  |
| `started_at` | timestamp with time zone | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `priority` | integer | **no** | `5` |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `kind` | text | **no** | `'ingest'::text` |

- CHECK `pipeline_jobs_kind_check`: `CHECK ((kind = ANY (ARRAY['ingest'::text, 'shred_solicitation'::text, 'scout_source'::text, 'draft_section'::text, 'review_section'::text, 'expand_topics'::text`
- CHECK `pipeline_jobs_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text])))`

### `pipeline_schedules`  · 13 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `source` | text | **no** |  |
| `run_type` | text | **no** | `'full'::text` |
| `cron_expression` | text | **no** |  |
| `enabled` | boolean | **no** | `true` |
| `next_run_at` | timestamp with time zone | yes |  |
| `last_run_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `platform_agent_config`  · 1 rows

| column | type | null | default |
|---|---|---|---|
| `id` | boolean | **no** | `true` |
| `default_monthly_budget` | numeric | **no** | `50.00` |
| `default_rate_limit_per_hour` | integer | **no** | `50` |
| `default_per_call_ceiling` | numeric | **no** | `0.50` |
| `platform_monthly_cap` | numeric | yes |  |
| `ai_enabled` | boolean | **no** | `true` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `updated_by` | uuid | yes |  |

- CHECK `platform_agent_config_id_check`: `CHECK ((id = true))`

### `procedural_memories`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `agent_role` | text | **no** |  |
| `embedding` | USER-DEFINED | **no** |  |
| `name` | text | **no** |  |
| `description` | text | **no** |  |
| `steps` | jsonb | **no** | `'[]'::jsonb` |
| `trigger_conditions` | jsonb | yes | `'{}'::jsonb` |
| `success_rate` | double precision | yes | `0.5` |
| `execution_count` | integer | **no** | `0` |
| `last_executed` | timestamp with time zone | yes |  |
| `is_active` | boolean | **no** | `true` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `namespace` | text | yes |  |

### `process_instance_transitions`  · 14,907 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `instance_id` | uuid | **no** |  |
| `from_status` | text | yes |  |
| `to_status` | text | **no** |  |
| `step_name` | text | yes |  |
| `actor` | text | yes |  |
| `reason` | text | yes |  |
| `metadata` | jsonb | yes | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | yes | `now()` |
| `affected_entity_type` | text | yes |  |
| `affected_entity_id` | uuid | yes |  |
| `content_version_before` | integer | yes |  |
| `content_version_after` | integer | yes |  |

### `process_instances`  · 4,941 rows · _RLS on · tenant-scoped · archivable_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `workflow_name` | text | **no** |  |
| `trigger_event_id` | uuid | yes |  |
| `correlation_id` | uuid | yes | `gen_random_uuid()` |
| `status` | text | **no** | `'pending'::text` |
| `current_step` | text | yes |  |
| `current_step_index` | integer | yes | `0` |
| `step_results` | jsonb | yes | `'{}'::jsonb` |
| `step_status` | jsonb | yes | `'{}'::jsonb` |
| `started_at` | timestamp with time zone | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `last_heartbeat_at` | timestamp with time zone | yes | `now()` |
| `deadline` | timestamp with time zone | yes |  |
| `retry_count` | integer | yes | `0` |
| `max_retries` | integer | yes | `3` |
| `last_error` | text | yes |  |
| `last_error_step` | text | yes |  |
| `recovered_from` | uuid | yes |  |
| `tenant_id` | uuid | yes |  |
| `actor_id` | uuid | yes |  |
| `actor_email` | text | yes |  |
| `payload` | jsonb | yes | `'{}'::jsonb` |
| `source` | text | **no** | `'pipeline'::text` |
| `created_at` | timestamp with time zone | yes | `now()` |
| `updated_at` | timestamp with time zone | yes | `now()` |
| `opportunity_id` | uuid | yes |  |
| `scope` | text | yes |  |
| `archived_at` | timestamp with time zone | yes |  |

- CHECK `process_instances_scope_check`: `CHECK (((scope IS NULL) OR (scope = ANY (ARRAY['opp'::text, 'spotlight'::text, 'project'::text, 'contract'::text]))))`
- CHECK `process_instances_source_check`: `CHECK ((source = ANY (ARRAY['pipeline'::text, 'cms'::text])))`
- CHECK `process_instances_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'paused'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'retrying'::text])))`

### `process_templates`  · 37 rows

| column | type | null | default |
|---|---|---|---|
| `workflow_name` | text | **no** |  |
| `description` | text | yes |  |
| `trigger_key` | text | yes |  |
| `source` | text | **no** | `'pipeline'::text` |
| `active` | boolean | **no** | `true` |
| `active_date` | timestamp with time zone | yes | `now()` |
| `inactive_date` | timestamp with time zone | yes |  |
| `inactivated_by` | text | yes |  |
| `memo` | text | yes |  |
| `first_registered_at` | timestamp with time zone | yes | `now()` |
| `last_seen_at` | timestamp with time zone | yes | `now()` |
| `created_at` | timestamp with time zone | yes | `now()` |
| `updated_at` | timestamp with time zone | yes | `now()` |

- CHECK `process_templates_source_check`: `CHECK ((source = ANY (ARRAY['pipeline'::text, 'cms'::text])))`

### `project_acceptance_evidence`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `deliverable_id` | uuid | **no** |  |
| `kind` | text | **no** |  |
| `customer_name` | text | yes |  |
| `customer_role` | text | yes |  |
| `occurred_on` | date | yes |  |
| `filename` | text | **no** |  |
| `storage_key` | text | **no** |  |
| `content_type` | text | yes |  |
| `byte_size` | bigint | yes |  |
| `note` | text | yes |  |
| `uploaded_by` | uuid | yes |  |
| `uploaded_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_acceptance_evidence_filename_len`: `CHECK (((length(filename) >= 1) AND (length(filename) <= 500)))`
- CHECK `project_acceptance_evidence_kind_check`: `CHECK ((kind = ANY (ARRAY['dd250'::text, 'cor_email'::text, 'signed_receipt'::text, 'transmittal'::text, 'other'::text])))`
- CHECK `project_acceptance_evidence_note_len`: `CHECK (((note IS NULL) OR (length(note) <= 4000)))`

### `project_assignments`  · 1 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `user_id` | uuid | **no** |  |
| `assigned_by` | uuid | **no** |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `project_cdrl_items`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `cdrl_number` | text | **no** |  |
| `title` | text | **no** |  |
| `did_number` | text | yes |  |
| `subtitle` | text | yes |  |
| `clin_id` | uuid | yes |  |
| `frequency` | text | **no** | `'one_time'::text` |
| `approval_code` | text | **no** | `'I'::text` |
| `distribution` | text | yes |  |
| `distribution_note` | text | yes |  |
| `first_due` | date | yes |  |
| `recurrence_days` | integer | yes |  |
| `notes` | text | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_cdrl_items_approval_code_check`: `CHECK ((approval_code = ANY (ARRAY['A'::text, 'I'::text])))`
- CHECK `project_cdrl_items_cdrl_number_check`: `CHECK (((length(btrim(cdrl_number)) >= 1) AND (length(btrim(cdrl_number)) <= 40)))`
- CHECK `project_cdrl_items_distribution_check`: `CHECK (((distribution IS NULL) OR (distribution = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'F'::text]))))`
- CHECK `project_cdrl_items_frequency_check`: `CHECK ((frequency = ANY (ARRAY['one_time'::text, 'monthly'::text, 'quarterly'::text, 'semiannual'::text, 'annual'::text, 'as_required'::text, 'with_each_milesto`
- CHECK `project_cdrl_items_recurrence_days_check`: `CHECK (((recurrence_days IS NULL) OR (recurrence_days > 0)))`
- CHECK `project_cdrl_items_recurring_needs_a_start`: `CHECK (((frequency = ANY (ARRAY['one_time'::text, 'as_required'::text, 'with_each_milestone'::text])) OR (first_due IS NOT NULL)))`
- CHECK `project_cdrl_items_title_check`: `CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 500)))`

### `project_clins`  · 2 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `clin_number` | text | **no** |  |
| `title` | text | **no** |  |
| `contract_type` | text | yes |  |
| `pop_start` | date | yes |  |
| `pop_end` | date | yes |  |
| `funded_amount` | numeric | yes |  |
| `sort_index` | integer | **no** | `0` |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `project_comments`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `entity_type` | text | **no** |  |
| `entity_id` | uuid | yes |  |
| `parent_id` | uuid | yes |  |
| `body` | text | **no** |  |
| `author_user_id` | uuid | **no** |  |
| `mentions` | ARRAY | **no** | `'{}'::uuid[]` |
| `resolved_at` | timestamp with time zone | yes |  |
| `resolved_by` | uuid | yes |  |
| `edited_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_comments_body_check`: `CHECK (((length(btrim(body)) >= 1) AND (length(btrim(body)) <= 10000)))`
- CHECK `project_comments_entity_pair`: `CHECK (((entity_type = 'project'::text) = (entity_id IS NULL)))`
- CHECK `project_comments_entity_type_check`: `CHECK ((entity_type = ANY (ARRAY['project'::text, 'milestone'::text, 'task'::text, 'deliverable'::text])))`
- CHECK `project_comments_resolved_pair`: `CHECK (((resolved_at IS NULL) = (resolved_by IS NULL)))`

### `project_deliverables`  · 3 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `milestone_id` | uuid | **no** |  |
| `title` | text | **no** |  |
| `required_by` | date | yes |  |
| `storage_key` | text | yes |  |
| `filename` | text | yes |  |
| `content_type` | text | yes |  |
| `byte_size` | bigint | yes |  |
| `uploaded_by` | uuid | yes |  |
| `uploaded_at` | timestamp with time zone | yes |  |
| `accepted_at` | timestamp with time zone | yes |  |
| `accepted_by` | uuid | yes |  |
| `sort_index` | integer | **no** | `0` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `document_id` | uuid | yes |  |
| `clin_id` | uuid | yes |  |
| `cdrl_item_id` | uuid | yes |  |
| `submitted_at` | timestamp with time zone | yes |  |
| `submitted_by` | uuid | yes |  |
| `transmittal_ref` | text | yes |  |

### `project_invoice_lines`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `invoice_id` | uuid | **no** |  |
| `clin_id` | uuid | **no** |  |
| `milestone_id` | uuid | yes |  |
| `description` | text | **no** |  |
| `source` | text | **no** | `'manual'::text` |
| `amount` | numeric | **no** |  |
| `sort_index` | integer | **no** | `0` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_invoice_lines_amount_check`: `CHECK ((amount <> (0)::numeric))`
- CHECK `project_invoice_lines_description_check`: `CHECK (((length(btrim(description)) >= 1) AND (length(btrim(description)) <= 500)))`
- CHECK `project_invoice_lines_source_check`: `CHECK ((source = ANY (ARRAY['milestone'::text, 'labour'::text, 'other_direct'::text, 'fee'::text, 'manual'::text])))`

### `project_invoices`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `invoice_number` | text | **no** |  |
| `period_start` | date | yes |  |
| `period_end` | date | yes |  |
| `status` | text | **no** | `'draft'::text` |
| `submitted_on` | date | yes |  |
| `paid_on` | date | yes |  |
| `amount_paid` | numeric | **no** | `0` |
| `void_reason` | text | yes |  |
| `document_id` | uuid | yes |  |
| `notes` | text | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_invoices_amount_paid_check`: `CHECK ((amount_paid >= (0)::numeric))`
- CHECK `project_invoices_invoice_number_check`: `CHECK (((length(btrim(invoice_number)) >= 1) AND (length(btrim(invoice_number)) <= 60)))`
- CHECK `project_invoices_paid_pair`: `CHECK (((status = 'paid'::text) = (paid_on IS NOT NULL)))`
- CHECK `project_invoices_period_order`: `CHECK (((period_start IS NULL) OR (period_end IS NULL) OR (period_end >= period_start)))`
- CHECK `project_invoices_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'paid'::text, 'void'::text])))`
- CHECK `project_invoices_submitted_pair`: `CHECK (((status = ANY (ARRAY['submitted'::text, 'paid'::text])) = (submitted_on IS NOT NULL)))`
- CHECK `project_invoices_void_reason`: `CHECK (((status <> 'void'::text) OR ((void_reason IS NOT NULL) AND (length(btrim(void_reason)) > 0))))`

### `project_meetings`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `title` | text | **no** |  |
| `held_on` | date | **no** |  |
| `attendees` | ARRAY | **no** | `'{}'::text[]` |
| `document_id` | uuid | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_meetings_title_check`: `CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 500)))`

### `project_milestone_tasks`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `milestone_id` | uuid | yes |  |
| `title` | text | **no** |  |
| `detail` | text | yes |  |
| `assignee_user_id` | uuid | yes |  |
| `assignee_role` | text | yes |  |
| `due_date` | date | yes |  |
| `status` | text | **no** | `'open'::text` |
| `blocked_reason` | text | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `completed_by` | uuid | yes |  |
| `nudges_sent` | integer | **no** | `0` |
| `last_nudged_at` | timestamp with time zone | yes |  |
| `sort_index` | integer | **no** | `0` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `scope` | text | **no** | `'milestone'::text` |
| `estimated_completion` | date | yes |  |
| `meeting_id` | uuid | yes |  |

- CHECK `project_milestone_tasks_assignee_role_check`: `CHECK ((assignee_role = ANY (ARRAY['tenant_admin'::text, 'tenant_user'::text])))`
- CHECK `project_milestone_tasks_blocked_has_reason`: `CHECK (((status <> 'blocked'::text) OR (blocked_reason IS NOT NULL)))`
- CHECK `project_milestone_tasks_done_has_time`: `CHECK (((status = 'done'::text) = (completed_at IS NOT NULL)))`
- CHECK `project_milestone_tasks_scope_check`: `CHECK ((scope = ANY (ARRAY['milestone'::text, 'project'::text])))`
- CHECK `project_milestone_tasks_scope_matches_milestone`: `CHECK (((scope = 'milestone'::text) = (milestone_id IS NOT NULL)))`
- CHECK `project_milestone_tasks_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'blocked'::text])))`
- CHECK `project_milestone_tasks_title_check`: `CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 500)))`

### `project_milestones`  · 3 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `clin_id` | uuid | yes |  |
| `title` | text | **no** |  |
| `baseline_date` | date | yes |  |
| `forecast_date` | date | yes |  |
| `status` | text | **no** | `'pending'::text` |
| `met_at` | timestamp with time zone | yes |  |
| `sort_index` | integer | **no** | `0` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `starts_on` | date | yes |  |
| `owner_user_id` | uuid | yes |  |
| `completion_note` | text | yes |  |
| `completion_metrics` | jsonb | yes |  |
| `nudges_sent` | integer | **no** | `0` |
| `last_nudged_at` | timestamp with time zone | yes |  |
| `depends_on_id` | uuid | yes |  |
| `code` | text | yes |  |
| `planned_cost` | numeric | yes |  |
| `actual_cost` | numeric | **no** | `0` |
| `baseline_cost` | numeric | yes |  |
| `gate_closer` | text | **no** | `'human'::text` |

- CHECK `project_milestones_gate_closer_check`: `CHECK ((gate_closer = ANY (ARRAY['human'::text, 'ai_manager'::text])))`
- CHECK `project_milestones_metrics_is_object`: `CHECK (((completion_metrics IS NULL) OR (jsonb_typeof(completion_metrics) = 'object'::text)))`
- CHECK `project_milestones_no_self_dependency`: `CHECK (((depends_on_id IS NULL) OR (depends_on_id <> id)))`
- CHECK `project_milestones_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'met'::text, 'missed'::text, 'waived'::text])))`
- CHECK `project_milestones_window_ordered`: `CHECK (((starts_on IS NULL) OR (forecast_date IS NULL) OR (forecast_date >= starts_on)))`

### `project_modification_changes`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `modification_id` | uuid | **no** |  |
| `action` | text | **no** |  |
| `clin_id` | uuid | yes |  |
| `field` | text | yes |  |
| `old_value` | text | yes |  |
| `new_value` | text | yes |  |
| `payload` | jsonb | **no** | `'{}'::jsonb` |
| `applied_at` | timestamp with time zone | yes |  |
| `sort_index` | integer | **no** | `0` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_modification_changes_action_check`: `CHECK ((action = ANY (ARRAY['amend'::text, 'add_clin'::text])))`
- CHECK `project_modification_changes_field_check`: `CHECK (((field IS NULL) OR (field = ANY (ARRAY['title'::text, 'contract_type'::text, 'pop_start'::text, 'pop_end'::text, 'funded_amount'::text]))))`
- CHECK `project_modification_changes_shape`: `CHECK ((((action = 'amend'::text) AND (clin_id IS NOT NULL) AND (field IS NOT NULL)) OR ((action = 'add_clin'::text) AND (field IS NULL))))`

### `project_modifications`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `mod_number` | text | **no** |  |
| `title` | text | **no** |  |
| `description` | text | yes |  |
| `kind` | text | **no** | `'funding'::text` |
| `status` | text | **no** | `'draft'::text` |
| `executed_on` | date | yes |  |
| `executed_by` | uuid | yes |  |
| `source_doc_id` | uuid | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_modifications_executed_pair`: `CHECK (((status = 'executed'::text) = (executed_on IS NOT NULL)))`
- CHECK `project_modifications_kind_check`: `CHECK ((kind = ANY (ARRAY['administrative'::text, 'funding'::text, 'scope'::text, 'schedule'::text, 'termination'::text])))`
- CHECK `project_modifications_mod_number_check`: `CHECK (((length(btrim(mod_number)) >= 1) AND (length(btrim(mod_number)) <= 60)))`
- CHECK `project_modifications_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'executed'::text])))`
- CHECK `project_modifications_title_check`: `CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 500)))`

### `project_provenance`  · 3 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `target_table` | text | **no** |  |
| `target_id` | uuid | **no** |  |
| `field` | text | **no** |  |
| `method` | text | **no** |  |
| `source_doc_id` | uuid | yes |  |
| `page` | integer | yes |  |
| `excerpt` | text | yes |  |
| `char_offset` | integer | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_provenance_method_check`: `CHECK ((method = ANY (ARRAY['hitl'::text, 'verified'::text, 'override'::text, 'pattern_match'::text, 'ai'::text, 'default'::text])))`

### `project_reviews`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `entity_type` | text | **no** |  |
| `entity_id` | uuid | **no** |  |
| `requested_by` | uuid | **no** |  |
| `reviewer_user_id` | uuid | yes |  |
| `reviewer_role` | text | yes |  |
| `note` | text | yes |  |
| `due_on` | date | yes |  |
| `status` | text | **no** | `'pending'::text` |
| `decided_by` | uuid | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `reason` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_reviews_decided_pair`: `CHECK (((status = 'pending'::text) = (decided_at IS NULL)))`
- CHECK `project_reviews_entity_type_check`: `CHECK ((entity_type = ANY (ARRAY['deliverable'::text, 'document'::text, 'milestone'::text])))`
- CHECK `project_reviews_has_reviewer`: `CHECK (((reviewer_user_id IS NOT NULL) OR (reviewer_role IS NOT NULL)))`
- CHECK `project_reviews_note_len`: `CHECK (((note IS NULL) OR (length(note) <= 4000)))`
- CHECK `project_reviews_reason_len`: `CHECK (((reason IS NULL) OR (length(reason) <= 4000)))`
- CHECK `project_reviews_rejection_has_reason`: `CHECK (((status <> 'rejected'::text) OR ((reason IS NOT NULL) AND (length(btrim(reason)) > 0))))`
- CHECK `project_reviews_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])))`

### `project_risks`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `milestone_id` | uuid | yes |  |
| `title` | text | **no** |  |
| `detail` | text | yes |  |
| `kind` | text | **no** | `'risk'::text` |
| `status` | text | **no** | `'open'::text` |
| `probability` | smallint | **no** | `3` |
| `impact` | smallint | **no** | `3` |
| `score` | smallint | yes |  |
| `owner_user_id` | uuid | yes |  |
| `mitigation` | text | yes |  |
| `contingency` | text | yes |  |
| `review_on` | date | yes |  |
| `became_issue_at` | timestamp with time zone | yes |  |
| `closed_at` | timestamp with time zone | yes |  |
| `closed_by` | uuid | yes |  |
| `closed_note` | text | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_risks_closed_pair`: `CHECK (((status = 'closed'::text) = (closed_at IS NOT NULL)))`
- CHECK `project_risks_impact_range`: `CHECK (((impact >= 1) AND (impact <= 5)))`
- CHECK `project_risks_issue_pair`: `CHECK (((kind = 'issue'::text) = (became_issue_at IS NOT NULL)))`
- CHECK `project_risks_kind_check`: `CHECK ((kind = ANY (ARRAY['risk'::text, 'issue'::text])))`
- CHECK `project_risks_probability_range`: `CHECK (((probability >= 1) AND (probability <= 5)))`
- CHECK `project_risks_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))`
- CHECK `project_risks_title_check`: `CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 500)))`

### `project_source_documents`  · 2 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `kind` | text | **no** |  |
| `storage_key` | text | **no** |  |
| `filename` | text | **no** |  |
| `content_type` | text | yes |  |
| `byte_size` | bigint | yes |  |
| `uploaded_by` | uuid | **no** |  |
| `uploaded_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_source_documents_kind_check`: `CHECK ((kind = ANY (ARRAY['executed_contract'::text, 'submitted_proposal'::text])))`

### `project_task_attachments`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `task_id` | uuid | **no** |  |
| `filename` | text | **no** |  |
| `storage_key` | text | **no** |  |
| `content_type` | text | yes |  |
| `byte_size` | bigint | yes |  |
| `uploaded_by` | uuid | yes |  |
| `uploaded_at` | timestamp with time zone | **no** | `now()` |

- CHECK `project_task_attachments_filename_check`: `CHECK (((length(filename) >= 1) AND (length(filename) <= 500)))`

### `project_time_entries`  · 0 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `project_id` | uuid | **no** |  |
| `task_id` | uuid | yes |  |
| `user_id` | uuid | **no** |  |
| `worked_on` | date | **no** |  |
| `hours` | numeric | **no** |  |
| `hourly_rate` | numeric | yes |  |
| `cost` | numeric | yes |  |
| `note` | text | yes |  |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `milestone_id` | uuid | **no** |  |
| `invoice_line_id` | uuid | yes |  |

- CHECK `project_time_entries_approved_pair`: `CHECK (((approved_at IS NULL) = (approved_by IS NULL)))`
- CHECK `project_time_entries_hours_range`: `CHECK (((hours > (0)::numeric) AND (hours <= (24)::numeric)))`
- CHECK `project_time_entries_note_len`: `CHECK (((note IS NULL) OR (length(note) <= 2000)))`
- CHECK `project_time_entries_rate_positive`: `CHECK (((hourly_rate IS NULL) OR (hourly_rate >= (0)::numeric)))`

### `projects`  · 1 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `contract_id` | uuid | yes |  |
| `name` | text | **no** |  |
| `status` | text | **no** | `'planning'::text` |
| `baselined_at` | timestamp with time zone | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `closed_at` | timestamp with time zone | yes |  |
| `closed_by` | uuid | yes |  |
| `closeout_note` | text | yes |  |
| `closeout_metrics` | jsonb | yes |  |
| `notification_policy` | jsonb | **no** | `'{}'::jsonb` |

- CHECK `projects_closed_has_time`: `CHECK (((status = 'closed'::text) = (closed_at IS NOT NULL)))`
- CHECK `projects_closeout_metrics_is_object`: `CHECK (((closeout_metrics IS NULL) OR (jsonb_typeof(closeout_metrics) = 'object'::text)))`
- CHECK `projects_status_check`: `CHECK ((status = ANY (ARRAY['planning'::text, 'active'::text, 'closing'::text, 'closed'::text])))`

### `promo_codes`  · 18 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `code` | text | **no** |  |
| `kind` | text | **no** | `'comp'::text` |
| `value` | integer | **no** | `0` |
| `active` | boolean | **no** | `true` |
| `max_uses` | integer | yes |  |
| `used_count` | integer | **no** | `0` |
| `expires_at` | timestamp with time zone | yes |  |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `issued_by` | uuid | yes |  |
| `issued_to` | text | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `revoked_by` | uuid | yes |  |
| `first_redeemed_at` | timestamp with time zone | yes |  |
| `redeemed_by_tenant_id` | uuid | yes |  |

- CHECK `promo_codes_kind_check`: `CHECK ((kind = ANY (ARRAY['comp'::text, 'percent'::text, 'amount'::text])))`
- CHECK `promo_codes_revoked_inactive`: `CHECK (((revoked_at IS NULL) OR (active = false)))`

### `proposal_activity_log`  · 120 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `tenant_id` | uuid | **no** |  |
| `actor_id` | uuid | yes |  |
| `actor_email` | text | yes |  |
| `actor_role` | text | yes |  |
| `activity_type` | text | **no** |  |
| `section_id` | uuid | yes |  |
| `section_title` | text | yes |  |
| `details` | jsonb | yes | `'{}'::jsonb` |
| `entity_version` | integer | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `proposal_activity_log_activity_type_check`: `CHECK ((activity_type = ANY (ARRAY['section_edited'::text, 'section_saved'::text, 'section_reverted'::text, 'section_assigned'::text, 'section_unassigned'::text`

### `proposal_amendment_flags`  · 9 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `amendment_id` | uuid | **no** |  |
| `proposal_id` | uuid | **no** |  |
| `tenant_id` | uuid | **no** |  |
| `acknowledged_by` | uuid | yes |  |
| `acknowledged_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `proposal_artifacts`  · 22 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `volume_id` | uuid | yes |  |
| `volume_number` | integer | yes |  |
| `volume_name` | text | yes |  |
| `artifact_type` | text | **no** | `'narrative'::text` |
| `format_spec` | jsonb | **no** | `'{}'::jsonb` |
| `compliance_spec` | jsonb | **no** | `'{}'::jsonb` |
| `is_required` | boolean | **no** | `true` |
| `status` | text | **no** | `'draft'::text` |
| `is_locked` | boolean | **no** | `false` |
| `locked_at` | timestamp with time zone | yes |  |
| `locked_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `proposal_artifacts_artifact_type_check`: `CHECK ((artifact_type = ANY (ARRAY['narrative'::text, 'cost'::text, 'form'::text, 'matrix'::text, 'other'::text])))`
- CHECK `proposal_artifacts_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'in_progress'::text, 'locked'::text])))`

### `proposal_collaborators`  · 13 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `user_id` | uuid | yes |  |
| `email` | text | **no** |  |
| `name` | text | yes |  |
| `role` | text | **no** | `'contributor'::text` |
| `invited_by` | uuid | yes |  |
| `invited_at` | timestamp with time zone | **no** | `now()` |
| `accepted_at` | timestamp with time zone | yes |  |
| `assigned_sections` | ARRAY | yes | `'{}'::uuid[]` |
| `dropbox_enabled` | boolean | yes | `true` |
| `revoked_at` | timestamp with time zone | yes |  |

### `proposal_comments`  · 4 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `section_id` | uuid | yes |  |
| `user_id` | uuid | **no** |  |
| `content` | text | **no** |  |
| `resolved` | boolean | **no** | `false` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `recommendation_type` | text | **no** | `'human'::text` |
| `category` | text | yes |  |
| `anchor` | jsonb | yes |  |

- CHECK `proposal_comments_recommendation_type_check`: `CHECK ((recommendation_type = ANY (ARRAY['human'::text, 'ai_review'::text, 'ai_suggestion'::text])))`

### `proposal_compliance_matrix`  · 71 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `requirement_text` | text | **no** |  |
| `requirement_source` | text | yes |  |
| `is_mandatory` | boolean | **no** | `true` |
| `status` | text | **no** | `'not_addressed'::text` |
| `section_id` | uuid | yes |  |
| `notes` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `proposal_compliance_matrix_status_check`: `CHECK ((status = ANY (ARRAY['not_addressed'::text, 'partial'::text, 'satisfied'::text, 'not_applicable'::text])))`

### `proposal_portals`  · 8 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `opportunity_id` | uuid | **no** |  |
| `proposal_id` | uuid | yes |  |
| `label` | text | **no** | `'primary'::text` |
| `status` | text | **no** | `'guardrails_pending'::text` |
| `guardrail_config` | jsonb | **no** | `'{}'::jsonb` |
| `launched_at` | timestamp with time zone | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `current_stage_index` | integer | **no** | `0` |
| `paid_at` | timestamp with time zone | yes |  |
| `curation_due_at` | timestamp with time zone | yes |  |

- CHECK `proposal_portals_status_check`: `CHECK ((status = ANY (ARRAY['guardrails_pending'::text, 'curation_pending'::text, 'launched'::text, 'executing'::text, 'closeout'::text, 'archived'::text, 'aban`

### `proposal_sections`  · 71 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `section_number` | text | **no** |  |
| `title` | text | **no** |  |
| `content` | text | yes |  |
| `page_allocation` | integer | yes |  |
| `status` | text | **no** | `'empty'::text` |
| `assigned_to` | uuid | yes |  |
| `requirement_ids` | ARRAY | yes | `'{}'::uuid[]` |
| `ai_confidence` | double precision | yes |  |
| `version` | integer | **no** | `1` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `last_modified_by` | uuid | yes |  |
| `editing_by` | uuid | yes |  |
| `editing_since` | timestamp with time zone | yes |  |
| `completed_stage` | text | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `accepted_by` | uuid | yes |  |
| `accepted_at` | timestamp with time zone | yes |  |
| `is_locked` | boolean | **no** | `false` |
| `locked_at` | timestamp with time zone | yes |  |
| `locked_by` | uuid | yes |  |
| `volume_name` | text | yes |  |
| `volume_number` | integer | yes |  |
| `section_type` | text | yes |  |
| `tags` | ARRAY | **no** | `'{}'::text[]` |
| `meta` | jsonb | **no** | `'{}'::jsonb` |
| `artifact_id` | uuid | yes |  |
| `sort_index` | integer | yes |  |
| `content_source` | text | yes |  |
| `character_allocation` | integer | yes |  |

- CHECK `proposal_sections_status_check`: `CHECK ((status = ANY (ARRAY['empty'::text, 'ai_drafted'::text, 'in_progress'::text, 'complete'::text, 'approved'::text])))`

### `proposal_stage_history`  · 22 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `from_stage` | text | yes |  |
| `to_stage` | text | **no** |  |
| `changed_by` | uuid | yes |  |
| `notes` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `proposal_supporting_docs`  · 9 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `tenant_id` | uuid | **no** |  |
| `requirement_label` | text | **no** |  |
| `requirement_source` | text | yes |  |
| `category` | text | **no** | `'supporting_document'::text` |
| `is_required` | boolean | **no** | `true` |
| `storage_key` | text | yes |  |
| `original_filename` | text | yes |  |
| `file_size` | integer | yes |  |
| `content_type` | text | yes |  |
| `status` | text | **no** | `'missing'::text` |
| `uploaded_by` | uuid | yes |  |
| `uploaded_at` | timestamp with time zone | yes |  |
| `reviewed_by` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `notes` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `proposal_supporting_docs_category_check`: `CHECK ((category = ANY (ARRAY['supporting_document'::text, 'proposal_input'::text, 'other'::text])))`
- CHECK `proposal_supporting_docs_status_check`: `CHECK ((status = ANY (ARRAY['missing'::text, 'uploaded'::text, 'reviewed'::text, 'approved'::text, 'waived'::text])))`

### `proposals`  · 9 rows · _RLS FORCED · tenant-scoped · archivable_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `opportunity_id` | uuid | **no** |  |
| `solicitation_id` | uuid | yes |  |
| `title` | text | **no** |  |
| `stage` | text | **no** | `'draft'::text` |
| `stripe_payment_id` | text | yes |  |
| `is_locked` | boolean | **no** | `false` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `gate_config` | jsonb | yes | `'["draft", "final"]'::jsonb` |
| `lock_count` | integer | **no** | `0` |
| `download_count` | integer | **no** | `0` |
| `last_locked_at` | timestamp with time zone | yes |  |
| `last_unlocked_at` | timestamp with time zone | yes |  |
| `unlock_deadline` | timestamp with time zone | yes |  |
| `version` | integer | **no** | `1` |
| `last_modified_by` | uuid | yes |  |
| `origin_card` | jsonb | **no** | `'{}'::jsonb` |
| `source_bucket` | text | yes |  |
| `voice` | jsonb | yes |  |
| `studio_phase` | text | yes |  |
| `studio_phase_status` | text | yes |  |
| `studio_auto` | boolean | **no** | `false` |
| `archived_at` | timestamp with time zone | yes |  |

- CHECK `proposals_stage_check`: `CHECK ((stage = ANY (ARRAY['draft'::text, 'review'::text, 'final'::text, 'submitted'::text, 'archived'::text])))`
- CHECK `proposals_studio_phase_check`: `CHECK (((studio_phase IS NULL) OR (studio_phase = ANY (ARRAY['draft'::text, 'refine'::text, 'compliance'::text, 'complete'::text]))))`
- CHECK `proposals_studio_phase_status_check`: `CHECK (((studio_phase_status IS NULL) OR (studio_phase_status = ANY (ARRAY['running'::text, 'awaiting_review'::text]))))`

### `purchases`  · 7 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `opportunity_id` | uuid | yes |  |
| `proposal_id` | uuid | yes |  |
| `stripe_session_id` | text | yes |  |
| `stripe_payment_intent` | text | yes |  |
| `product_type` | text | **no** |  |
| `amount_cents` | integer | **no** |  |
| `status` | text | **no** | `'pending'::text` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `metadata` | jsonb | yes | `'{}'::jsonb` |
| `promo_code` | text | yes |  |

- CHECK `purchases_product_type_check`: `CHECK ((product_type = ANY (ARRAY['finder_subscription'::text, 'proposal_phase1'::text, 'proposal_phase2'::text, 'expert_consulting'::text])))`
- CHECK `purchases_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'refunded'::text])))`

### `rate_limit_state`  · 3 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `source` | text | **no** |  |
| `daily_limit` | integer | **no** | `1000` |
| `daily_used` | integer | **no** | `0` |
| `hourly_limit` | integer | **no** | `100` |
| `hourly_used` | integer | **no** | `0` |
| `last_reset_daily` | timestamp with time zone | yes | `now()` |
| `last_reset_hourly` | timestamp with time zone | yes | `now()` |

### `sbir_awards`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `company_name` | text | **no** |  |
| `award_title` | text | yes |  |
| `agency` | text | yes |  |
| `branch` | text | yes |  |
| `phase` | text | yes |  |
| `program` | text | yes |  |
| `agency_tracking_number` | text | yes |  |
| `contract` | text | yes |  |
| `proposal_award_date` | date | yes |  |
| `contract_end_date` | date | yes |  |
| `solicitation_number` | text | yes |  |
| `solicitation_year` | text | yes |  |
| `solicitation_close_date` | date | yes |  |
| `proposal_receipt_date` | date | yes |  |
| `date_of_notification` | date | yes |  |
| `topic_code` | text | yes |  |
| `award_year` | text | yes |  |
| `award_amount` | numeric | yes |  |
| `uei` | text | yes |  |
| `duns` | text | yes |  |
| `hubzone_owned` | boolean | yes | `false` |
| `disadvantaged` | boolean | yes | `false` |
| `woman_owned` | boolean | yes | `false` |
| `number_employees` | integer | yes |  |
| `company_website` | text | yes |  |
| `address1` | text | yes |  |
| `address2` | text | yes |  |
| `city` | text | yes |  |
| `state` | text | yes |  |
| `zip` | text | yes |  |
| `abstract` | text | yes |  |
| `contact_name` | text | yes |  |
| `contact_title` | text | yes |  |
| `contact_phone` | text | yes |  |
| `contact_email` | text | yes |  |
| `pi_name` | text | yes |  |
| `pi_title` | text | yes |  |
| `pi_phone` | text | yes |  |
| `pi_email` | text | yes |  |
| `ri_name` | text | yes |  |
| `ri_poc_name` | text | yes |  |
| `ri_poc_phone` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `sbir_companies`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `company_name` | text | **no** |  |
| `uei` | text | yes |  |
| `duns` | text | yes |  |
| `address1` | text | yes |  |
| `address2` | text | yes |  |
| `city` | text | yes |  |
| `state` | text | yes |  |
| `zip` | text | yes |  |
| `country` | text | yes |  |
| `company_url` | text | yes |  |
| `hubzone_owned` | boolean | yes | `false` |
| `woman_owned` | boolean | yes | `false` |
| `disadvantaged` | boolean | yes | `false` |
| `number_awards` | integer | yes | `0` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `sbir_data_uploads`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `filename` | text | **no** |  |
| `file_hash` | text | **no** |  |
| `file_type` | text | **no** |  |
| `row_count` | integer | **no** | `0` |
| `uploaded_by` | uuid | yes |  |
| `storage_key` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `sbir_data_uploads_file_type_check`: `CHECK ((file_type = ANY (ARRAY['company'::text, 'award'::text])))`

### `scout_findings`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `source_id` | uuid | yes |  |
| `run_id` | uuid | yes |  |
| `purpose` | text | **no** | `'content'::text` |
| `kind` | text | yes |  |
| `title` | text | yes |  |
| `url` | text | yes |  |
| `snippet` | text | yes |  |
| `author` | text | yes |  |
| `published_at` | timestamp with time zone | yes |  |
| `discovered_at` | timestamp with time zone | **no** | `now()` |
| `status` | text | **no** | `'new'::text` |
| `outcome` | text | yes |  |
| `acted_at` | timestamp with time zone | yes |  |
| `dedup_hash` | text | yes |  |
| `raw` | jsonb | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `classification` | text | **no** | `'unknown'::text` |
| `match_opportunity_id` | uuid | yes |  |
| `similarity_score` | double precision | yes |  |
| `match_reason` | text | yes |  |
| `classified_at` | timestamp with time zone | yes |  |
| `released_kind` | text | yes |  |
| `released_ref` | uuid | yes |  |
| `reviewed_by` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |

- CHECK `scout_findings_classification_check`: `CHECK ((classification = ANY (ARRAY['new'::text, 'update'::text, 'unknown'::text])))`
- CHECK `scout_findings_purpose_check`: `CHECK ((purpose = ANY (ARRAY['content'::text, 'opportunity'::text, 'both'::text])))`
- CHECK `scout_findings_released_kind_check`: `CHECK ((released_kind = ANY (ARRAY['new'::text, 'update'::text])))`
- CHECK `scout_findings_status_check`: `CHECK ((status = ANY (ARRAY['new'::text, 'reviewed'::text, 'reposted'::text, 'drafted'::text, 'pursued'::text, 'dismissed'::text])))`

### `scout_runs`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `role` | text | **no** |  |
| `kind` | text | **no** |  |
| `source_id` | uuid | yes |  |
| `trigger_event_id` | uuid | yes |  |
| `triggered_by` | text | **no** | `'cron'::text` |
| `started_at` | timestamp with time zone | **no** | `now()` |
| `finished_at` | timestamp with time zone | yes |  |
| `found_count` | integer | **no** | `0` |
| `new_count` | integer | **no** | `0` |
| `acted_count` | integer | **no** | `0` |
| `status` | text | **no** | `'running'::text` |
| `outcome` | text | yes |  |
| `error` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `scout_runs_role_check`: `CHECK ((role = ANY (ARRAY['scout'::text, 'watcher'::text, 'publisher'::text])))`
- CHECK `scout_runs_status_check`: `CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))`

### `scout_sources`  · 3 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `name` | text | **no** |  |
| `kind` | text | **no** |  |
| `url` | text | **no** |  |
| `handle` | text | yes |  |
| `purpose` | text | **no** | `'content'::text` |
| `enabled` | boolean | **no** | `false` |
| `cron_expression` | text | yes |  |
| `last_crawled_at` | timestamp with time zone | yes |  |
| `notes` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `scout_sources_kind_check`: `CHECK ((kind = ANY (ARRAY['website'::text, 'social'::text, 'rss'::text, 'sitemap'::text])))`
- CHECK `scout_sources_purpose_check`: `CHECK ((purpose = ANY (ARRAY['content'::text, 'opportunity'::text, 'both'::text])))`

### `section_standards`  · 21 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `key` | text | **no** |  |
| `label` | text | **no** |  |
| `parent_key` | text | yes |  |
| `category` | text | yes |  |
| `program_types` | ARRAY | **no** | `'{}'::text[]` |
| `description` | text | yes |  |
| `sort_order` | integer | **no** | `0` |
| `is_active` | boolean | **no** | `true` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `semantic_memories`  · 26 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `agent_role` | text | **no** |  |
| `embedding` | USER-DEFINED | **no** |  |
| `content` | text | **no** |  |
| `category` | text | **no** |  |
| `subcategory` | text | yes |  |
| `confidence` | double precision | **no** | `0.5` |
| `evidence_count` | integer | **no** | `1` |
| `relationships` | jsonb | yes | `'[]'::jsonb` |
| `source_memories` | ARRAY | yes | `'{}'::uuid[]` |
| `valid_from` | timestamp with time zone | yes | `now()` |
| `valid_until` | timestamp with time zone | yes |  |
| `version` | integer | **no** | `1` |
| `previous_version` | uuid | yes |  |
| `is_active` | boolean | **no** | `true` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `last_accessed` | timestamp with time zone | **no** | `now()` |
| `access_count` | integer | **no** | `0` |
| `namespace` | text | yes |  |

### `sessions`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `session_token` | text | **no** |  |
| `user_id` | uuid | **no** |  |
| `expires` | timestamp with time zone | **no** |  |

### `shadow_admin_grants`  · 5 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `portal_id` | uuid | **no** |  |
| `admin_user_id` | uuid | yes |  |
| `admin_email` | text | yes |  |
| `source` | text | **no** |  |
| `active` | boolean | **no** | `true` |
| `granted_by` | uuid | yes |  |
| `granted_at` | timestamp with time zone | **no** | `now()` |
| `revoked_by` | uuid | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |

- CHECK `shadow_admin_grants_source_check`: `CHECK ((source = ANY (ARRAY['t_and_c'::text, 'invite'::text])))`

### `solicitation_amendments`  · 9 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `label` | text | **no** |  |
| `summary` | text | **no** |  |
| `compliance_delta` | jsonb | **no** | `'[]'::jsonb` |
| `severity` | text | **no** | `'major'::text` |
| `source` | text | **no** | `'manual'::text` |
| `status` | text | **no** | `'detected'::text` |
| `detected_by` | uuid | yes |  |
| `detected_at` | timestamp with time zone | **no** | `now()` |
| `reviewed_by` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `document_id` | uuid | yes |  |

- CHECK `solicitation_amendments_severity_check`: `CHECK ((severity = ANY (ARRAY['critical'::text, 'major'::text, 'minor'::text, 'info'::text])))`
- CHECK `solicitation_amendments_source_check`: `CHECK ((source = ANY (ARRAY['manual'::text, 'amendment_monitor'::text])))`
- CHECK `solicitation_amendments_status_check`: `CHECK ((status = ANY (ARRAY['detected'::text, 'confirmed'::text, 'dismissed'::text])))`

### `solicitation_annotations`  · 56 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `actor_id` | uuid | **no** |  |
| `kind` | text | **no** |  |
| `source_location` | jsonb | **no** |  |
| `payload` | jsonb | **no** | `'{}'::jsonb` |
| `compliance_variable_name` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `excerpt` | text | yes |  |

- CHECK `solicitation_annotations_kind_check`: `CHECK ((kind = ANY (ARRAY['highlight'::text, 'text_box'::text, 'compliance_tag'::text])))`

### `solicitation_compliance`  · 20 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `page_limit_technical` | integer | yes |  |
| `page_limit_cost` | integer | yes |  |
| `page_limit_other` | jsonb | yes |  |
| `font_family` | text | yes |  |
| `font_size` | text | yes |  |
| `margins` | text | yes |  |
| `line_spacing` | text | yes |  |
| `header_required` | boolean | yes | `false` |
| `header_format` | text | yes |  |
| `footer_required` | boolean | yes | `false` |
| `footer_format` | text | yes |  |
| `submission_format` | text | yes |  |
| `images_tables_allowed` | boolean | yes | `true` |
| `slides_allowed` | boolean | yes | `false` |
| `slide_limit` | integer | yes |  |
| `slide_order` | jsonb | yes |  |
| `required_sections` | jsonb | **no** | `'[]'::jsonb` |
| `required_documents` | jsonb | **no** | `'[]'::jsonb` |
| `evaluation_criteria` | jsonb | **no** | `'[]'::jsonb` |
| `taba_allowed` | boolean | yes |  |
| `indirect_rate_cap` | numeric | yes |  |
| `partner_max_pct` | numeric | yes |  |
| `cost_sharing_required` | boolean | yes | `false` |
| `cost_volume_format` | text | yes |  |
| `pi_must_be_employee` | boolean | yes |  |
| `pi_university_allowed` | boolean | yes |  |
| `clearance_required` | text | yes |  |
| `itar_required` | boolean | yes | `false` |
| `far_clauses` | ARRAY | yes | `'{}'::text[]` |
| `custom_variables` | jsonb | yes | `'{}'::jsonb` |
| `verified_by` | uuid | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `topic_id` | uuid | yes |  |
| `min_font_size` | numeric | yes |  |
| `field_provenance` | jsonb | **no** | `'{}'::jsonb` |
| `character_limit_narrative` | integer | yes |  |

### `solicitation_compliance_drafts`  · 8 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `parsed` | jsonb | **no** | `'{}'::jsonb` |
| `field_provenance` | jsonb | **no** | `'{}'::jsonb` |
| `audit` | jsonb | **no** | `'{}'::jsonb` |
| `review` | jsonb | **no** | `'{}'::jsonb` |
| `guidance` | text | yes |  |
| `status` | text | **no** | `'staged'::text` |
| `phase` | text | **no** | `'matrix'::text` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `reviewed_at` | timestamp with time zone | yes |  |
| `landed_at` | timestamp with time zone | yes |  |
| `landed_by` | uuid | yes |  |

- CHECK `solicitation_compliance_drafts_phase_check`: `CHECK ((phase = ANY (ARRAY['extract'::text, 'matrix'::text, 'review'::text])))`
- CHECK `solicitation_compliance_drafts_status_check`: `CHECK ((status = ANY (ARRAY['staged'::text, 'reviewed'::text, 'landed'::text, 'superseded'::text, 'rejected'::text])))`

### `solicitation_documents`  · 11 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `document_type` | text | **no** | `'source'::text` |
| `original_filename` | text | **no** |  |
| `storage_key` | text | **no** |  |
| `file_size` | bigint | yes |  |
| `content_type` | text | yes |  |
| `page_count` | integer | yes |  |
| `extracted_text` | text | yes |  |
| `extracted_at` | timestamp with time zone | yes |  |
| `uploaded_by` | uuid | yes |  |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `content_hash` | text | yes |  |
| `is_primary` | boolean | **no** | `false` |
| `document_label` | text | yes |  |

- CHECK `solicitation_documents_document_type_check`: `CHECK ((document_type = ANY (ARRAY['source'::text, 'rfp'::text, 'nofo'::text, 'instructions'::text, 'amendment'::text, 'qa'::text, 'template'::text, 'supporting`

### `solicitation_outlines`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `outline` | jsonb | **no** |  |
| `notes` | text | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `solicitation_volumes`  · 22 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `volume_number` | integer | **no** |  |
| `volume_name` | text | **no** |  |
| `volume_format` | text | yes | `'custom'::text` |
| `description` | text | yes |  |
| `special_requirements` | ARRAY | **no** | `'{}'::text[]` |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `applies_to_phase` | ARRAY | yes |  |
| `topic_id` | uuid | yes |  |
| `expert_notes` | text | yes |  |

- CHECK `solicitation_volumes_volume_format_check`: `CHECK ((volume_format = ANY (ARRAY['dsip_standard'::text, 'l_and_m'::text, 'custom'::text])))`

### `source_diffs`  · 1 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `profile_id` | uuid | **no** |  |
| `region_id` | uuid | yes |  |
| `prev_snapshot_id` | uuid | yes |  |
| `next_snapshot_id` | uuid | yes |  |
| `is_meaningful` | boolean | yes | `false` |
| `summary` | text | yes |  |
| `extracted_opportunities` | jsonb | yes | `'[]'::jsonb` |
| `severity` | text | yes | `'info'::text` |
| `claude_model` | text | yes |  |
| `claude_tokens_used` | integer | yes |  |
| `reviewed_by` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | yes | `now()` |

- CHECK `source_diffs_severity_check`: `CHECK ((severity = ANY (ARRAY['info'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text])))`

### `source_health`  · 3 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `source` | text | **no** |  |
| `status` | text | **no** | `'unknown'::text` |
| `consecutive_failures` | integer | **no** | `0` |
| `last_success_at` | timestamp with time zone | yes |  |
| `last_failure_at` | timestamp with time zone | yes |  |
| `avg_duration_ms` | integer | yes |  |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `source_health_status_check`: `CHECK ((status = ANY (ARRAY['healthy'::text, 'degraded'::text, 'error'::text, 'unknown'::text])))`

### `source_profiles`  · 6 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `name` | text | **no** |  |
| `site_type` | text | **no** | `'custom'::text` |
| `base_url` | text | **no** |  |
| `bookmark_url` | text | yes |  |
| `agency` | text | yes |  |
| `program_type` | text | yes |  |
| `admin_notes` | text | yes |  |
| `visit_instructions` | text | yes |  |
| `topic_url_pattern` | text | yes |  |
| `pdf_url_pattern` | text | yes |  |
| `is_active` | boolean | **no** | `true` |
| `last_visited_at` | timestamp with time zone | yes |  |
| `last_visited_by` | uuid | yes |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `auto_crawl_enabled` | boolean | yes | `false` |
| `crawl_cron` | text | yes | `'0 6 * * *'::text` |
| `last_crawl_at` | timestamp with time zone | yes |  |
| `crawl_config` | jsonb | yes | `'{}'::jsonb` |

- CHECK `source_profiles_site_type_check`: `CHECK ((site_type = ANY (ARRAY['dsip'::text, 'sam_gov'::text, 'sbir_gov'::text, 'grants_gov'::text, 'afwerx'::text, 'xtech'::text, 'nsf'::text, 'custom'::text])`

### `source_regions`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `profile_id` | uuid | **no** |  |
| `name` | text | **no** |  |
| `selector_hint` | text | yes |  |
| `content_context` | text | yes |  |
| `region_type` | text | yes | `'content'::text` |
| `sample_html` | text | yes |  |
| `sample_text` | text | yes |  |
| `is_active` | boolean | yes | `true` |
| `created_at` | timestamp with time zone | yes | `now()` |
| `updated_at` | timestamp with time zone | yes | `now()` |

- CHECK `source_regions_region_type_check`: `CHECK ((region_type = ANY (ARRAY['content'::text, 'listing'::text, 'download'::text, 'navigation'::text, 'table'::text])))`

### `source_snapshots`  · 1 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `profile_id` | uuid | **no** |  |
| `region_id` | uuid | yes |  |
| `content_hash` | text | **no** |  |
| `content_text` | text | yes |  |
| `raw_html_s3_key` | text | yes |  |
| `captured_at` | timestamp with time zone | yes | `now()` |

### `source_visits`  · 1 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `profile_id` | uuid | **no** |  |
| `visited_by` | uuid | yes |  |
| `action` | text | **no** |  |
| `url` | text | yes |  |
| `notes` | text | yes |  |
| `files_count` | integer | yes | `0` |
| `topics_count` | integer | yes | `0` |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `source_visits_action_check`: `CHECK ((action = ANY (ARRAY['visit'::text, 'download'::text, 'upload'::text, 'paste_topics'::text, 'import_topics'::text, 'shred'::text, 'note'::text])))`

### `stage_completion_snapshots`  · 4 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `stage` | text | **no** |  |
| `completed_by` | uuid | yes |  |
| `completed_at` | timestamp with time zone | **no** | `now()` |
| `sections_snapshot` | jsonb | **no** | `'[]'::jsonb` |
| `total_sections` | integer | **no** | `0` |
| `sections_complete` | integer | **no** | `0` |
| `sections_approved` | integer | **no** | `0` |
| `notes` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `stage_gate_requirements`  · 0 rows · _RLS FORCED_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `proposal_id` | uuid | **no** |  |
| `stage` | text | **no** |  |
| `requirement_type` | text | **no** |  |
| `label` | text | **no** |  |
| `description` | text | yes |  |
| `is_met` | boolean | **no** | `false` |
| `met_by` | uuid | yes |  |
| `met_at` | timestamp with time zone | yes |  |
| `evidence` | jsonb | yes | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `stage_gate_requirements_requirement_type_check`: `CHECK ((requirement_type = ANY (ARRAY['all_sections_complete'::text, 'compliance_check_passed'::text, 'min_sections_approved'::text, 'admin_review_complete'::te`

### `system_events`  · 72,399 rows · _tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `namespace` | text | **no** |  |
| `type` | text | **no** |  |
| `phase` | text | **no** |  |
| `actor_type` | text | **no** |  |
| `actor_id` | text | **no** |  |
| `actor_email` | text | yes |  |
| `tenant_id` | uuid | yes |  |
| `parent_event_id` | uuid | yes |  |
| `payload` | jsonb | **no** | `'{}'::jsonb` |
| `error` | jsonb | yes |  |
| `duration_ms` | integer | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `system_events_actor_type_check`: `CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text, 'pipeline'::text, 'agent'::text])))`
- CHECK `system_events_namespace_chk`: `CHECK ((namespace = ANY (ARRAY['finder'::text, 'capture'::text, 'identity'::text, 'proposal'::text, 'library'::text, 'system'::text, 'tool'::text, 'project'::te`
- CHECK `system_events_phase_check`: `CHECK ((phase = ANY (ARRAY['start'::text, 'end'::text, 'single'::text])))`

### `system_health_snapshots`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `captured_at` | timestamp with time zone | **no** | `now()` |
| `queue_depth` | integer | **no** | `0` |
| `events_last_hour` | integer | **no** | `0` |
| `errors_last_hour` | integer | **no** | `0` |
| `db_reachable` | boolean | **no** | `true` |
| `s3_reachable` | boolean | **no** | `true` |
| `notes` | jsonb | yes | `'{}'::jsonb` |

### `tasks`  · 287 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | yes |  |
| `assignee_role` | text | yes |  |
| `assignee_user_id` | uuid | yes |  |
| `task_type` | text | **no** |  |
| `title` | text | **no** |  |
| `description` | text | yes |  |
| `entity_type` | text | yes |  |
| `entity_id` | uuid | yes |  |
| `process_instance_id` | uuid | yes |  |
| `step_name` | text | yes |  |
| `status` | text | **no** | `'open'::text` |
| `due_at` | timestamp with time zone | yes |  |
| `nudge_schedule` | jsonb | yes | `'[]'::jsonb` |
| `nudges_sent` | jsonb | yes | `'[]'::jsonb` |
| `params` | jsonb | yes | `'{}'::jsonb` |
| `result` | jsonb | yes |  |
| `completed_by` | uuid | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | yes | `now()` |
| `updated_at` | timestamp with time zone | yes | `now()` |

- CHECK `tasks_assignee_present`: `CHECK (((assignee_role IS NOT NULL) OR (assignee_user_id IS NOT NULL) OR (tenant_id IS NOT NULL)))`
- CHECK `tasks_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'expired'::text])))`

### `taxonomy_terms`  · 122 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `dimension` | text | **no** |  |
| `value` | text | **no** |  |
| `label` | text | **no** |  |
| `program_types` | ARRAY | **no** | `'{}'::text[]` |
| `sort_order` | integer | **no** | `0` |
| `is_active` | boolean | **no** | `true` |
| `created_at` | timestamp with time zone | **no** | `now()` |

### `template_bridge`  · 43 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `template_id` | uuid | **no** |  |
| `version` | integer | **no** |  |
| `event_type` | text | **no** |  |
| `template` | jsonb | **no** |  |
| `posted_by` | uuid | yes |  |
| `posted_at` | timestamp with time zone | **no** | `now()` |

- CHECK `template_bridge_event_type_check`: `CHECK ((event_type = ANY (ARRAY['published'::text, 'updated'::text, 'deprecated'::text, 'republished'::text])))`

### `tenant_agent_config`  · 1 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `enabled_agents` | ARRAY | yes | `'{}'::text[]` |
| `monthly_budget` | numeric | yes | `50.00` |
| `monthly_used` | numeric | yes | `0.00` |
| `preferences` | jsonb | yes | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `rate_limit_per_hour` | integer | yes |  |
| `per_call_ceiling` | numeric | yes |  |

### `tenant_automation_policies`  · 1 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `scope` | text | **no** |  |
| `trigger_key` | text | **no** |  |
| `enabled` | boolean | **no** | `true` |
| `recipient_roles` | ARRAY | **no** | `'{}'::text[]` |
| `recipient_users` | ARRAY | **no** | `'{}'::uuid[]` |
| `recipient_flags` | ARRAY | **no** | `'{}'::text[]` |
| `condition` | jsonb | **no** | `'{}'::jsonb` |
| `due_in_minutes` | integer | yes |  |
| `relative_anchor` | text | yes |  |
| `relative_offset_minutes` | integer | yes |  |
| `nudge_days` | ARRAY | **no** | `'{1,3}'::integer[]` |
| `channel` | text | **no** | `'email'::text` |
| `cooldown_minutes` | integer | **no** | `0` |
| `max_fires_per_hour` | integer | **no** | `0` |
| `configured_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `tenant_automation_policies_channel_check`: `CHECK ((channel = ANY (ARRAY['email'::text, 'todo'::text, 'both'::text])))`
- CHECK `tenant_automation_policies_relative_anchor_check`: `CHECK ((relative_anchor = ANY (ARRAY['open_date'::text, 'close_date'::text, 'stage_entered'::text])))`
- CHECK `tenant_automation_policies_scope_check`: `CHECK ((scope = ANY (ARRAY['discovery'::text, 'build'::text, 'project'::text])))`

### `tenant_bridge_cursor`  · 8 rows · _tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `tenant_id` | uuid | **no** |  |
| `last_posted_at` | timestamp with time zone | **no** | `'1970-01-01 00:00:00+00'::timestamp with` |
| `last_event_id` | uuid | yes |  |
| `last_applied_at` | timestamp with time zone | **no** | `now()` |

### `tenant_bucket_scores`  · 430 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `bucket_id` | uuid | **no** |  |
| `opportunity_id` | uuid | **no** |  |
| `score` | integer | **no** | `0` |
| `factors` | jsonb | **no** | `'{}'::jsonb` |
| `computed_at` | timestamp with time zone | **no** | `now()` |

- CHECK `chk_tbs_score_range`: `CHECK (((score >= 0) AND (score <= 100)))`

### `tenant_documents`  · 13 rows · _RLS on · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `title` | text | **no** |  |
| `doc_type` | text | **no** | `'custom'::text` |
| `status` | text | **no** | `'draft'::text` |
| `canvas` | jsonb | **no** | `'{}'::jsonb` |
| `source_template_id` | uuid | yes |  |
| `node_count` | integer | **no** | `0` |
| `version` | integer | **no** | `1` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `source_template_key` | text | yes |  |
| `atomized_at` | timestamp with time zone | yes |  |
| `library_foundation_id` | uuid | yes |  |

- CHECK `tenant_documents_doc_type_check`: `CHECK ((doc_type = ANY (ARRAY['technical_volume'::text, 'cost_volume'::text, 'slide_deck'::text, 'past_performance'::text, 'key_personnel'::text, 'commercializa`
- CHECK `tenant_documents_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'final'::text])))`

### `tenant_opportunity_cards`  · 688 rows · _RLS FORCED · tenant-scoped · archivable_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `opportunity_id` | uuid | **no** |  |
| `card` | jsonb | **no** |  |
| `bridge_version` | integer | **no** | `0` |
| `lifecycle_status` | text | **no** | `'open'::text` |
| `pursuit_status` | text | **no** | `'unreviewed'::text` |
| `docs_copied` | boolean | **no** | `false` |
| `docs_update_available` | boolean | **no** | `false` |
| `docs_copied_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `copied_docs` | jsonb | **no** | `'[]'::jsonb` |
| `submission_stage` | text | **no** | `'open'::text` |
| `archived_at` | timestamp with time zone | yes |  |
| `start_nudges_sent` | integer | **no** | `0` |
| `start_nudged_at` | timestamp with time zone | yes |  |
| `card_tsv` | tsvector | yes |  |
| `pursuit_set_at` | timestamp with time zone | yes |  |

- CHECK `tenant_opportunity_cards_lifecycle_status_check`: `CHECK ((lifecycle_status = ANY (ARRAY['open'::text, 'closed'::text, 'archived'::text])))`
- CHECK `tenant_opportunity_cards_pursuit_status_check`: `CHECK ((pursuit_status = ANY (ARRAY['unreviewed'::text, 'pursuing'::text, 'monitoring'::text, 'passed'::text])))`
- CHECK `tenant_opportunity_cards_submission_stage_check`: `CHECK ((submission_stage = ANY (ARRAY['nofo'::text, 'pre_release'::text, 'open'::text, 'updated'::text, 'closed'::text, 'archived'::text])))`

### `tenant_opportunity_documents`  · 1 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `opportunity_id` | uuid | **no** |  |
| `source_document_id` | uuid | **no** |  |
| `document_type` | text | **no** |  |
| `document_label` | text | yes |  |
| `original_filename` | text | **no** |  |
| `is_primary` | boolean | **no** | `false` |
| `content_hash` | text | yes |  |
| `page_count` | integer | yes |  |
| `char_count` | integer | **no** | `0` |
| `storage_key` | text | yes |  |
| `pinned_key` | text | yes |  |
| `extracted_text` | text | yes |  |
| `text_tsv` | tsvector | yes |  |
| `bridge_version` | integer | **no** | `0` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

- CHECK `tenant_opp_docs_type_check`: `CHECK ((document_type = ANY (ARRAY['source'::text, 'rfp'::text, 'nofo'::text, 'instructions'::text, 'amendment'::text, 'qa'::text, 'template'::text, 'supporting`

### `tenant_profiles`  · 2 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `naics_codes` | ARRAY | yes | `'{}'::text[]` |
| `keywords` | ARRAY | yes | `'{}'::text[]` |
| `agency_priorities` | ARRAY | yes | `'{}'::text[]` |
| `set_aside_types` | ARRAY | yes | `'{}'::text[]` |
| `technology_focus` | text | yes |  |
| `company_summary` | text | yes |  |
| `research_areas` | ARRAY | yes | `'{}'::text[]` |
| `target_agencies` | ARRAY | yes | `'{}'::text[]` |
| `min_surface_score` | integer | yes | `40` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `tenant_spotlight_buckets`  · 5 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `name` | text | **no** |  |
| `description` | text | yes |  |
| `criteria` | jsonb | **no** | `'{}'::jsonb` |
| `is_active` | boolean | **no** | `true` |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `tenant_template_cards`  · 312 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tenant_id` | uuid | **no** |  |
| `template_id` | uuid | **no** |  |
| `template` | jsonb | **no** |  |
| `bridge_version` | integer | **no** | `0` |
| `template_key` | text | **no** |  |
| `title` | text | **no** |  |
| `category` | text | **no** |  |
| `agency` | text | yes |  |
| `format` | text | **no** | `'document'::text` |
| `update_available` | boolean | **no** | `false` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |

### `tenants`  · 9 rows · _archivable_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `slug` | text | **no** |  |
| `name` | text | **no** |  |
| `legal_name` | text | yes |  |
| `website` | text | yes |  |
| `status` | text | **no** | `'trial'::text` |
| `product_tier` | text | **no** | `'finder'::text` |
| `billing_email` | text | yes |  |
| `trial_ends_at` | timestamp with time zone | yes |  |
| `storage_root` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `stripe_customer_id` | text | yes |  |
| `subscription_status` | text | **no** | `'none'::text` |
| `lifecycle_stage` | text | yes | `'customer'::text` |
| `archived_at` | timestamp with time zone | yes |  |
| `owner_id` | uuid | yes |  |
| `kind` | text | **no** | `'standard'::text` |

- CHECK `tenants_kind_check`: `CHECK ((kind = ANY (ARRAY['standard'::text, 'partner_org'::text])))`
- CHECK `tenants_lifecycle_stage_check`: `CHECK ((lifecycle_stage = ANY (ARRAY['lead'::text, 'target'::text, 'customer'::text, 'at_risk'::text, 'churned'::text])))`
- CHECK `tenants_product_tier_check`: `CHECK ((product_tier = ANY (ARRAY['finder'::text, 'reminder'::text, 'binder'::text, 'grinder'::text])))`
- CHECK `tenants_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'churned'::text, 'trial'::text])))`
- CHECK `tenants_subscription_status_check`: `CHECK ((subscription_status = ANY (ARRAY['none'::text, 'active'::text, 'past_due'::text, 'canceled'::text])))`

### `tool_invocation_metrics`  · 77 rows · _tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `tool_name` | text | **no** |  |
| `tool_namespace` | text | **no** |  |
| `actor_type` | text | **no** |  |
| `actor_id` | text | **no** |  |
| `tenant_id` | uuid | yes |  |
| `success` | boolean | **no** |  |
| `error_code` | text | yes |  |
| `duration_ms` | integer | **no** |  |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `tool_invocation_metrics_actor_type_check`: `CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text, 'pipeline'::text, 'agent'::text])))`

### `triage_actions`  · 28 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `solicitation_id` | uuid | **no** |  |
| `actor_id` | uuid | **no** |  |
| `action` | text | **no** |  |
| `from_state` | text | **no** |  |
| `to_state` | text | **no** |  |
| `notes` | text | yes |  |
| `metadata` | jsonb | yes | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |

- CHECK `triage_actions_action_check`: `CHECK ((action = ANY (ARRAY['claim'::text, 'release'::text, 'dismiss'::text, 'request_review'::text, 'approve'::text, 'reject'::text, 'push'::text, 'reclaim'::t`

### `user_memberships`  · 27 rows · _tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `user_id` | uuid | **no** |  |
| `tenant_id` | uuid | **no** |  |
| `role` | text | **no** |  |
| `status` | text | **no** | `'active'::text` |
| `source` | text | **no** | `'home'::text` |
| `scope` | jsonb | **no** | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `created_by` | uuid | yes |  |
| `can_manage_buckets` | boolean | **no** | `false` |

- CHECK `user_memberships_role_check`: `CHECK ((role = ANY (ARRAY['master_admin'::text, 'rfp_admin'::text, 'tenant_admin'::text, 'tenant_user'::text, 'partner_user'::text])))`
- CHECK `user_memberships_source_check`: `CHECK ((source = ANY (ARRAY['home'::text, 'shadow_t_and_c'::text, 'collaborator'::text, 'manual'::text, 'partner_manager'::text])))`
- CHECK `user_memberships_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'invited'::text, 'revoked'::text])))`

### `users`  · 47 rows · _tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `email` | text | **no** |  |
| `name` | text | yes |  |
| `role` | text | **no** | `'tenant_user'::text` |
| `tenant_id` | uuid | yes |  |
| `password_hash` | text | yes |  |
| `is_active` | boolean | **no** | `true` |
| `temp_password` | boolean | **no** | `false` |
| `last_login_at` | timestamp with time zone | yes |  |
| `terms_accepted_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `timezone` | text | **no** | `'UTC'::text` |

- CHECK `users_role_check`: `CHECK ((role = ANY (ARRAY['master_admin'::text, 'rfp_admin'::text, 'partner_admin'::text, 'tenant_admin'::text, 'tenant_user'::text, 'partner_user'::text])))`

### `vault_members`  · 2 rows · _RLS FORCED · tenant-scoped_

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `vault_id` | uuid | **no** |  |
| `tenant_id` | uuid | **no** |  |
| `email` | text | **no** |  |
| `user_id` | uuid | yes |  |
| `role` | text | **no** | `'partner_user'::text` |
| `status` | text | **no** | `'invited'::text` |
| `invited_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `revoked_at` | timestamp with time zone | yes |  |

- CHECK `vault_members_role_check`: `CHECK ((role = 'partner_user'::text))`
- CHECK `vault_members_status_check`: `CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'revoked'::text])))`

### `verification_tokens`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `identifier` | text | **no** |  |
| `token` | text | **no** |  |
| `expires` | timestamp with time zone | **no** |  |

### `visitor_sessions`  · 52 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `session_id` | text | **no** |  |
| `first_page` | text | yes |  |
| `referrer` | text | yes |  |
| `user_agent` | text | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `ip_hash` | text | yes |  |
| `device_type` | text | yes |  |
| `country` | text | yes |  |
| `last_seen_at` | timestamp with time zone | yes | `now()` |
| `page_count` | integer | yes | `0` |
| `region` | text | yes |  |
| `city` | text | yes |  |
| `isp` | text | yes |  |
| `org` | text | yes |  |
| `asn` | text | yes |  |
| `timezone` | text | yes |  |
| `latitude` | double precision | yes |  |
| `longitude` | double precision | yes |  |

### `volume_required_items`  · 69 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `volume_id` | uuid | **no** |  |
| `item_number` | integer | **no** |  |
| `item_name` | text | **no** |  |
| `item_type` | text | **no** | `'word_doc'::text` |
| `required` | boolean | **no** | `true` |
| `page_limit` | integer | yes |  |
| `slide_limit` | integer | yes |  |
| `font_family` | text | yes |  |
| `font_size` | text | yes |  |
| `margins` | text | yes |  |
| `line_spacing` | text | yes |  |
| `header_format` | text | yes |  |
| `footer_format` | text | yes |  |
| `required_sections` | jsonb | **no** | `'[]'::jsonb` |
| `format_rules` | jsonb | **no** | `'{}'::jsonb` |
| `custom_fields` | jsonb | **no** | `'{}'::jsonb` |
| `source_excerpts` | jsonb | **no** | `'[]'::jsonb` |
| `metadata` | jsonb | **no** | `'{}'::jsonb` |
| `verified_by` | uuid | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `updated_at` | timestamp with time zone | **no** | `now()` |
| `applies_to_phase` | ARRAY | yes |  |
| `min_font_size` | numeric | yes |  |
| `canvas_preset` | jsonb | **no** | `'{}'::jsonb` |
| `compliance_preset` | jsonb | **no** | `'{}'::jsonb` |
| `template_id` | uuid | yes |  |
| `expert_notes` | text | yes |  |
| `character_limit` | integer | yes |  |

- CHECK `volume_required_items_item_type_check`: `CHECK ((item_type = ANY (ARRAY['word_doc'::text, 'slide_deck'::text, 'spreadsheet'::text, 'pdf'::text, 'text'::text, 'form_sf424'::text, 'form_sbir_certs'::text`

### `waitlist`  · 0 rows

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | **no** | `gen_random_uuid()` |
| `email` | text | **no** |  |
| `company_name` | text | yes |  |
| `metadata` | jsonb | yes | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | **no** | `now()` |
| `session_id` | text | yes |  |
| `contact_id` | uuid | yes |  |

---

## 3. Vocabularies — the actual values, not the plausible ones

Every low-cardinality text column, with live counts. **A value not listed here does not**
**exist in this database.** `proposal_sections.status = 'locked'` matched nothing all night
because `locked` is not a member — the lock is `locked_at IS NOT NULL`.

| column | values (count) |
|---|---|
| `agent_performance.agent_role` | `packaging_specialist(2)` · `pp_matcher(2)` · `section_drafter(2)` · `cost_estimator(2)` · `proposal_architect(2)` · `color_team_reviewer(2)` · `library_seed_suggester(2)` · `outcome_analyst(2)` · `research_scout(2)` · `capture_strategist(2)` |
| `agent_task_log.status` | `completed(463)` · `failed(7)` |
| `agent_task_queue.agent_role` | `library_seed_suggester(4)` · `color_team_reviewer(3)` · `scoring_strategist(1)` · `librarian(1)` · `opportunity_analyst(1)` |
| `agent_task_queue.status` | `completed(10)` |
| `agent_task_queue.task_type` | `seed_suggest(4)` · `review_section(3)` · `analyze_fit(1)` · `score_adjustment(1)` · `catalog(1)` |
| `api_key_registry.source` | `anthropic(1)` · `grants_gov(1)` · `sbir_gov(1)` · `sam_gov(1)` |
| `applications.source` | `public(1)` |
| `applications.status` | `accepted(1)` |
| `atom_embeddings.model` | `local-hash-v1(1102)` |
| `atom_tags.tag_source` | `admin(9234)` · `auto(1744)` |
| `automation_log.action_taken` | `fired(24)` · `recorded(8)` |
| `automation_log.action_type` | `notify_admin(15)` · `create_todo(9)` · `send_email(8)` |
| `automation_log.status` | `success(24)` · `deferred(8)` |
| `automation_rules.action_type` | `send_email(7)` · `notify_admin(5)` · `create_todo(2)` · `publish_content(1)` · `unpublish_content(1)` · `distribute_social(1)` |
| `automation_rules.trigger_namespace` | `capture(6)` · `proposal(4)` · `finder(3)` · `system(2)` · `identity(1)` · `library(1)` |
| `canvas_versions.source` | `human_edit(6)` · `system(3)` · `ai_draft(3)` |
| `cms_content.content_type` | `page_block(116)` · `resource(8)` · `blog_post(3)` · `guide(2)` · `team_member(1)` |
| `cms_content.status` | `published(130)` |
| `collaboration_vaults.status` | `active(1)` |
| `collaborator_stage_access.stage` | `draft(13)` · `final(13)` |
| `command_seen_state.scope` | `admin(4)` · `tenant:17780cad-76c0-4cef-95ec-2a536bcf5c8f(1)` · `tenant:8f126bc2-1152-44e5-8473-3761c744d806(1)` |
| `compliance_presets.phase_type` | `direct_to_phase_2(2)` · `phase_1(2)` · `tvsf(1)` · `phase_2(1)` |
| `compliance_presets.program_type` | `sbir_phase_2(2)` · `sttr(1)` · `sbir_phase_1(1)` · `tvsf(1)` · `cso(1)` |
| `compliance_variables.data_type` | `boolean(7)` · `select(5)` · `text(5)` · `number(4)` · `multiselect(4)` |
| `contacts.source` | `application(1)` |
| `content_pages.content_type` | `page(40)` · `guide(23)` · `resource(9)` · `blog_post(3)` · `team_member(1)` |
| `content_pages.status` | `archived(32)` · `active(32)` · `draft(12)` |
| `contracts.status` | `active(2)` |
| `curated_solicitations.ingest_phase` | `not_started(32)` · `matrix(4)` |
| `curated_solicitations.namespace` | `pending(19)` · `DOD:SMALL BUSINESS INNOVATION RESEARCH:SBIR:Phase1(7)` · `DOD:unknown:BAA:Open(4)` · `ARMY:A:STTR:Phase1(1)` · `NAVY:N:SBIR:Phase2(1)` · `CHEMICAL AND BIOLOGICAL DEFENSE:CBD:CSO:Open(1)` · `USAF:AF:SBIR:Phase1(1)` · `NSF:SBIR:Phase1(1)` · `DOE:SBIR:Phase1(1)` |
| `curated_solicitations.solicitation_type` | `single(34)` · `multi_topic(2)` |
| `curated_solicitations.status` | `new(16)` · `approved(10)` · `pushed_to_pipeline(10)` |
| `curation_revisions.revision_type` | `annotation_added(91)` · `review_requested(12)` · `status_changed(4)` · `review_approved(4)` · `compliance_updated(4)` |
| `document_cocoons.scope` | `document(8)` |
| `document_cocoons.source` | `upload(5)` · `download(3)` |
| `document_templates.template_type` | `custom(6)` · `abstract(1)` · `slide_deck(1)` · `past_performance(1)` |
| `email_send_ledger.kind` | `transactional(21)` |
| `email_send_ledger.status` | `failed(21)` |
| `episodic_memories.memory_type` | `interaction(443)` · `outcome(130)` · `decision(12)` |
| `episodic_memories.namespace` | `DOD:unknown:BAA:Open(12)` |
| `episodic_memories.source` | `fabric(443)` · `outcome_attributor(130)` · `5ee22abf-26ea-4676-bb14-c1cab17d2be2(3)` · `43846780-36e8-49d5-bc27-f9e878b8ce1a(3)` · `77c71e1b-c6f6-45a2-8091-73faffd9df14(3)` · `079609cd-ba18-4bb1-9096-4cf61b809bf4(3)` |
| `expert_availability_blocks.status` | `booked(1)` |
| `expert_time_bookings.status` | `booked(1)` |
| `library_atoms.creator_kind` | `admin(1659)` · `ai(3)` |
| `library_atoms.outcome` | `pending(1659)` · `awarded(3)` |
| `library_atoms.source` | `download_derivative(912)` · `manual(493)` · `upload(257)` |
| `library_atoms.status` | `approved(1662)` |
| `library_atoms.visibility` | `tenant(1662)` |
| `library_seed_jobs.status` | `analyzing(4)` |
| `master_templates.format` | `document(27)` · `spreadsheet(7)` · `deck(5)` |
| `master_templates.status` | `active(39)` |
| `opportunities.lifecycle_status` | `open(106)` |
| `opportunities.phase_type` | `phase_1(58)` · `direct_to_phase_2(17)` · `other(1)` |
| `opportunities.program_type` | `sbir_phase_1(91)` · `baa(4)` · `sbir(4)` · `sttr(2)` · `tvsf(2)` · `sttr_phase_1(1)` · `sbir_phase_2(1)` · `cso(1)` |
| `opportunities.set_aside_type` | `Small Business SBIR/STTR Program(4)` |
| `opportunities.source` | `manual_upload(77)` · `intake:admin(16)` · `sbir_gov(6)` · `dsip(4)` · `manual(3)` |
| `opportunities.submission_stage` | `open(96)` · `pre_release(10)` |
| `opportunities.topic_status` | `open(106)` |
| `opportunity_bridge.event_type` | `published(490)` · `updated(69)` |
| `pipeline_jobs.kind` | `ingest(10)` · `scout_source(5)` |
| `pipeline_jobs.run_type` | `full(15)` |
| `pipeline_jobs.source` | `sam_gov(4)` · `dsip(4)` · `scout_source(3)` · `scout(2)` · `sbir_gov(2)` |
| `pipeline_jobs.status` | `completed(13)` · `failed(2)` |
| `pipeline_schedules.run_type` | `full(6)` · `event(4)` · `incremental(3)` |
| `process_instance_transitions.from_status` | `running(4968)` · `pending(4941)` · `paused(30)` · `retrying(27)` |
| `process_instance_transitions.to_status` | `running(4968)` · `pending(4941)` · `completed(4870)` · `paused(98)` · `retrying(27)` · `failed(3)` |
| `process_instances.scope` | `contract(16)` · `opp(4)` |
| `process_instances.source` | `pipeline(4941)` |
| `process_instances.status` | `completed(4870)` · `paused(68)` · `failed(3)` |
| `process_templates.source` | `pipeline(37)` |
| `project_clins.contract_type` | `CPFF(1)` · `FFP(1)` |
| `project_milestones.status` | `pending(2)` · `met(1)` |
| `project_source_documents.content_type` | `application/pdf(2)` |
| `project_source_documents.kind` | `executed_contract(1)` · `submitted_proposal(1)` |
| `projects.status` | `active(1)` |
| `promo_codes.kind` | `comp(18)` |
| `proposal_activity_log.activity_type` | `proposal_exported(83)` · `collaborator_invited(12)` · `outcome_recorded(12)` · `ai_draft_requested(9)` · `stage_advanced(4)` |
| `proposal_activity_log.actor_role` | `tenant_admin(120)` |
| `proposal_artifacts.artifact_type` | `narrative(9)` · `form(9)` · `cost(4)` |
| `proposal_artifacts.status` | `locked(21)` · `draft(1)` |
| `proposal_collaborators.role` | `external(13)` |
| `proposal_comments.recommendation_type` | `ai_review(3)` · `human(1)` |
| `proposal_compliance_matrix.requirement_source` | `Proposal(27)` · `Technical Volume(22)` · `RFP(4)` · `Supporting Documents(3)` · `Proposal Cover Sheet(2)` · `Supporting Letters(2)` · `Company Commercialization Report(2)` · `Fraud, Waste and Abuse Training(2)` · `Cost Volume(2)` · `Budget(2)` |
| `proposal_compliance_matrix.status` | `satisfied(68)` · `not_addressed(3)` |
| `proposal_portals.status` | `closeout(4)` · `launched(4)` |
| `proposal_sections.completed_stage` | `draft(53)` · `final(15)` |
| `proposal_sections.content_source` | `human_edit(48)` |
| `proposal_sections.section_type` | `cost(2)` · `facilities(2)` · `technical.objectives(2)` · `team(1)` |
| `proposal_sections.status` | `approved(68)` · `in_progress(3)` |
| `proposal_stage_history.from_stage` | `submitted(12)` · `draft(4)` · `final(4)` |
| `proposal_stage_history.to_stage` | `archived(12)` · `submitted(4)` · `final(4)` · `draft(1)` |
| `proposal_supporting_docs.requirement_source` | `solicitation §5.2(1)` |
| `proposal_supporting_docs.status` | `missing(9)` |
| `proposals.stage` | `archived(4)` · `submitted(3)` · `draft(1)` · `final(1)` |
| `purchases.product_type` | `proposal_phase1(7)` |
| `purchases.status` | `completed(7)` |
| `rate_limit_state.source` | `sam_gov(1)` · `grants_gov(1)` · `sbir_gov(1)` |
| `scout_sources.kind` | `website(2)` · `rss(1)` |
| `semantic_memories.agent_role` | `outcome_tracker(4)` · `library_seed_suggester(3)` · `proposal_architect(2)` · `cost_estimator(2)` · `capture_strategist(2)` · `pp_matcher(2)` · `packaging_specialist(2)` · `research_scout(2)` · `outcome_analyst(2)` · `advisory_manager(2)` · `continuity_manager(2)` · `section_drafter(1)` |
| `shadow_admin_grants.source` | `t_and_c(5)` |
| `solicitation_amendments.severity` | `critical(9)` |
| `solicitation_amendments.source` | `manual(9)` |
| `solicitation_amendments.status` | `confirmed(9)` |
| `solicitation_annotations.kind` | `highlight(56)` |
| `solicitation_compliance.submission_format` | `SBIR/STTR technical volume(5)` · `Electronic submission via DSIP. PDF, 8.5x11, 1in margins, Times New Roman 11pt.(4)` · `DoW SBIR/STTR Innovation Portal (DSIP) — 8.5x11, single column, single-spaced(1)` · `DoW SBIR/STTR Innovation Portal (DSIP) — single PDF, 8.5x11, single column(1)` · `Proposal (<=7 pages, Abstract excluded) + Budget(1)` · `Proposal (≤7 pages, Abstract excluded) + Budget(1)` |
| `solicitation_compliance_drafts.phase` | `matrix(8)` |
| `solicitation_compliance_drafts.status` | `staged(4)` · `superseded(4)` |
| `solicitation_documents.content_type` | `application/pdf(11)` |
| `solicitation_documents.document_type` | `source(11)` |
| `solicitation_volumes.volume_format` | `dsip_standard(12)` · `custom(10)` |
| `source_health.source` | `sam_gov(1)` · `grants_gov(1)` · `sbir_gov(1)` |
| `source_health.status` | `unknown(3)` |
| `source_profiles.program_type` | `sbir(4)` · `ota(1)` |
| `source_profiles.site_type` | `dsip(2)` · `nsf(1)` · `sam_gov(1)` · `xtech(1)` · `afwerx(1)` |
| `source_visits.action` | `visit(1)` |
| `stage_completion_snapshots.stage` | `draft(4)` |
| `system_events.actor_type` | `system(65090)` · `user(5580)` · `pipeline(2140)` · `agent(1066)` |
| `system_events.namespace` | `system(60568)` · `capture(5644)` · `tool(2106)` · `finder(1293)` · `library(1207)` · `identity(1166)` · `proposal(1027)` · `project(865)` |
| `system_events.phase` | `single(70413)` · `start(1733)` · `end(1730)` |
| `tasks.assignee_role` | `rfp_admin(76)` · `tenant_admin(71)` · `tenant_user(10)` |
| `tasks.entity_type` | `project_milestone_task(100)` · `proposal(55)` · `project_review(20)` · `solicitation(19)` · `contract(12)` · `application(10)` · `content_pages(10)` · `project_modification(10)` · `project_comment(10)` · `source_profile(9)` · `portal(8)` |
| `tasks.status` | `completed(155)` · `open(130)` · `expired(2)` |
| `template_bridge.event_type` | `published(39)` · `republished(4)` |
| `tenant_documents.doc_type` | `custom(12)` |
| `tenant_documents.status` | `draft(12)` |
| `tenant_opportunity_cards.lifecycle_status` | `open(688)` |
| `tenant_opportunity_cards.pursuit_status` | `unreviewed(687)` · `monitoring(1)` |
| `tenant_opportunity_cards.submission_stage` | `open(688)` |
| `tenant_template_cards.format` | `document(216)` · `spreadsheet(56)` · `deck(40)` |
| `tenants.kind` | `standard(6)` · `partner_org(2)` |
| `tenants.lifecycle_stage` | `customer(8)` |
| `tenants.product_tier` | `finder(7)` · `grinder(1)` |
| `tenants.status` | `active(8)` |
| `tenants.subscription_status` | `none(8)` |
| `tool_invocation_metrics.actor_type` | `user(77)` |
| `tool_invocation_metrics.tool_namespace` | `compliance(69)` · `solicitation(8)` |
| `triage_actions.action` | `request_review(16)` · `push(4)` · `approve(4)` · `skip_shredder(4)` |
| `triage_actions.from_state` | `curation_in_progress(16)` · `approved(4)` · `review_requested(4)` · `ai_analyzed(4)` |
| `triage_actions.to_state` | `review_requested(16)` · `pushed_to_pipeline(4)` · `approved(4)` · `curation_in_progress(4)` |
| `user_memberships.role` | `partner_user(13)` · `tenant_admin(10)` · `tenant_user(4)` |
| `user_memberships.source` | `home(14)` · `collaborator(12)` · `partner_manager(1)` |
| `user_memberships.status` | `active(27)` |
| `users.role` | `partner_user(32)` · `tenant_admin(6)` · `tenant_user(5)` · `master_admin(2)` · `partner_admin(2)` |
| `vault_members.role` | `partner_user(1)` |
| `vault_members.status` | `active(1)` |
| `visitor_sessions.device_type` | `desktop(52)` |
| `volume_required_items.item_type` | `word_doc(32)` · `text(22)` · `pdf(5)` · `form_other(4)` · `spreadsheet(4)` · `form_sf424(2)` |

---

## 4. Links — and which direction is actually written

A foreign key that EXISTS tells you nothing about whether it is POPULATED. B46: the push
writes `curated_solicitations.opportunity_id` and leaves `opportunities.solicitation_id`
NULL, so a join on the back-link found nothing and two separate drive scripts reported
"nothing reached a tenant card" against a push that had fanned seventeen.

**Read the fill column before joining.** Anything below ~90% is a link you cannot rely on.

| from | → to | filled |
|---|---|---|
| `accounts.user_id` | `users.id` | — |
| `agent_performance.tenant_id` | `tenants.id` | 100% (20/20) |
| `agent_task_log.proposal_id` | `proposals.id` | 36% (173/481) ⚠️ |
| `agent_task_log.section_id` | `proposal_sections.id` | 3% (14/481) ⚠️ |
| `agent_task_log.tenant_id` | `tenants.id` | 80% (383/481) ⚠️ |
| `agent_task_queue.proposal_id` | `proposals.id` | 70% (7/10) ⚠️ |
| `agent_task_queue.section_id` | `proposal_sections.id` | 30% (3/10) ⚠️ |
| `agent_task_queue.tenant_id` | `tenants.id` | 100% (10/10) |
| `agent_task_results.task_id` | `agent_task_queue.id` | 100% (10/10) |
| `applications.contact_id` | `contacts.id` | 100% (1/1) |
| `applications.reviewed_by` | `users.id` | 100% (1/1) |
| `applications.tenant_id` | `tenants.id` | 100% (1/1) |
| `atom_embeddings.atom_id` | `library_atoms.id` | 100% (1102/1102) |
| `atom_embeddings.tenant_id` | `tenants.id` | 100% (1102/1102) |
| `atom_lineage.child_atom_id` | `library_atoms.id` | — |
| `atom_lineage.parent_atom_id` | `library_atoms.id` | — |
| `atom_members.group_atom_id` | `library_atoms.id` | 100% (1300/1300) |
| `atom_members.member_atom_id` | `library_atoms.id` | 100% (1300/1300) |
| `atom_tags.atom_id` | `library_atoms.id` | 100% (10978/10978) |
| `atom_tags.confirmed_by` | `users.id` | 85% (9320/10978) ⚠️ |
| `automation_framework.updated_by` | `users.id` | 100% (1/1) |
| `automation_log.rule_id` | `automation_rules.id` | 100% (32/32) |
| `automation_rules.created_by` | `users.id` | 0% (0/17) ⚠️ |
| `canvas_versions.created_by` | `users.id` | 25% (3/12) ⚠️ |
| `canvas_versions.parent_version_id` | `canvas_versions.id` | 0% (0/12) ⚠️ |
| `canvas_versions.section_id` | `proposal_sections.id` | 100% (12/12) |
| `cms_content.created_by` | `users.id` | 0% (0/130) ⚠️ |
| `collaboration_vaults.created_by` | `users.id` | 100% (1/1) |
| `collaboration_vaults.tenant_id` | `tenants.id` | 100% (1/1) |
| `collaborator_stage_access.collaborator_id` | `proposal_collaborators.id` | 100% (26/26) |
| `collaborator_stage_access.granted_by` | `users.id` | 100% (26/26) |
| `collaborator_stage_access.proposal_id` | `proposals.id` | 100% (26/26) |
| `command_seen_state.user_id` | `users.id` | 100% (6/6) |
| `compliance_presets.created_by` | `users.id` | 0% (0/6) ⚠️ |
| `consent_records.user_id` | `users.id` | — |
| `contracts.opportunity_id` | `opportunities.id` | 100% (2/2) |
| `contracts.proposal_id` | `proposals.id` | 0% (0/2) ⚠️ |
| `contracts.tenant_id` | `tenants.id` | 100% (2/2) |
| `curated_solicitations.ai_similar_to` | `curated_solicitations.id` | 0% (0/36) ⚠️ |
| `curated_solicitations.approved_by` | `users.id` | 11% (4/36) ⚠️ |
| `curated_solicitations.build_completed_by` | `users.id` | 14% (5/36) ⚠️ |
| `curated_solicitations.claimed_by` | `users.id` | 0% (0/36) ⚠️ |
| `curated_solicitations.curated_by` | `users.id` | 36% (13/36) ⚠️ |
| `curated_solicitations.opportunity_id` | `opportunities.id` | 100% (36/36) |
| `curated_solicitations.review_requested_for` | `users.id` | 0% (0/36) ⚠️ |
| `curation_notes.author_id` | `users.id` | — |
| `curation_notes.solicitation_id` | `curated_solicitations.id` | — |
| `curation_revisions.actor_id` | `users.id` | 100% (115/115) |
| `curation_revisions.solicitation_id` | `curated_solicitations.id` | 100% (115/115) |
| `document_cocoons.origin_document_id` | `tenant_documents.id` | 0% (0/8) ⚠️ |
| `document_cocoons.tenant_id` | `tenants.id` | 100% (8/8) |
| `document_templates.created_by` | `users.id` | 0% (0/9) ⚠️ |
| `document_templates.tenant_id` | `tenants.id` | 0% (0/9) ⚠️ |
| `email_send_ledger.tenant_id` | `tenants.id` | 52% (11/21) ⚠️ |
| `episodic_memories.superseded_by` | `episodic_memories.id` | 0% (0/585) ⚠️ |
| `episodic_memories.tenant_id` | `tenants.id` | 98% (573/585) |
| `expert_availability_blocks.admin_user_id` | `users.id` | 100% (1/1) |
| `expert_time_bookings.admin_user_id` | `users.id` | 100% (1/1) |
| `expert_time_bookings.block_id` | `expert_availability_blocks.id` | 100% (1/1) |
| `expert_time_bookings.booked_by_user_id` | `users.id` | 100% (1/1) |
| `expert_time_bookings.tenant_id` | `tenants.id` | 100% (1/1) |
| `guardrail_templates.created_by` | `users.id` | 0% (0/1) ⚠️ |
| `guardrail_templates.tenant_id` | `tenants.id` | 0% (0/1) ⚠️ |
| `library_atoms.cocoon_id` | `document_cocoons.id` | 15% (250/1662) ⚠️ |
| `library_atoms.created_by` | `users.id` | 100% (1662/1662) |
| `library_atoms.owner_user_id` | `users.id` | 99% (1652/1662) |
| `library_atoms.tenant_id` | `tenants.id` | 100% (1662/1662) |
| `library_atoms.vault_id` | `collaboration_vaults.id` | 0% (0/1662) ⚠️ |
| `library_seed_jobs.proposal_id` | `proposals.id` | 100% (4/4) |
| `library_seed_jobs.source_proposal_id` | `proposals.id` | 0% (0/4) ⚠️ |
| `library_seed_jobs.tenant_id` | `tenants.id` | 100% (4/4) |
| `master_templates.created_by` | `users.id` | 0% (0/39) ⚠️ |
| `notification_read_state.tenant_id` | `tenants.id` | 100% (1/1) |
| `notification_read_state.user_id` | `users.id` | 100% (1/1) |
| `opportunities.built_by` | `users.id` | 13% (14/106) ⚠️ |
| `opportunities.origin_document_id` | `solicitation_documents.id` | 0% (0/106) ⚠️ |
| `opportunities.released_by` | `users.id` | 4% (4/106) ⚠️ |
| `opportunities.solicitation_id` | `curated_solicitations.id` | 90% (95/106) ⚠️ |
| `opportunities.update_watch_by` | `users.id` | 1% (1/106) ⚠️ |
| `opportunity_bridge.opportunity_id` | `opportunities.id` | 100% (559/559) |
| `opportunity_bridge.posted_by` | `users.id` | 91% (506/559) |
| `opportunity_lifecycle_actions.actor_id` | `users.id` | — |
| `opportunity_lifecycle_actions.opportunity_id` | `opportunities.id` | — |
| `procedural_memories.tenant_id` | `tenants.id` | — |
| `process_instance_transitions.instance_id` | `process_instances.id` | 100% (14907/14907) |
| `process_instances.tenant_id` | `tenants.id` | 98% (4851/4941) |
| `process_instances.trigger_event_id` | `system_events.id` | 100% (4941/4941) |
| `project_acceptance_evidence.deliverable_id` | `project_deliverables.id` | — |
| `project_acceptance_evidence.project_id` | `projects.id` | — |
| `project_acceptance_evidence.tenant_id` | `tenants.id` | — |
| `project_acceptance_evidence.uploaded_by` | `users.id` | — |
| `project_assignments.assigned_by` | `users.id` | 100% (1/1) |
| `project_assignments.project_id` | `projects.id` | 100% (1/1) |
| `project_assignments.tenant_id` | `tenants.id` | 100% (1/1) |
| `project_assignments.user_id` | `users.id` | 100% (1/1) |
| `project_cdrl_items.clin_id` | `project_clins.id` | — |
| `project_cdrl_items.created_by` | `users.id` | — |
| `project_cdrl_items.project_id` | `projects.id` | — |
| `project_cdrl_items.tenant_id` | `tenants.id` | — |
| `project_clins.project_id` | `projects.id` | 100% (2/2) |
| `project_clins.tenant_id` | `tenants.id` | 100% (2/2) |
| `project_comments.author_user_id` | `users.id` | — |
| `project_comments.parent_id` | `project_comments.id` | — |
| `project_comments.project_id` | `projects.id` | — |
| `project_comments.resolved_by` | `users.id` | — |
| `project_comments.tenant_id` | `tenants.id` | — |
| `project_deliverables.accepted_by` | `users.id` | 33% (1/3) ⚠️ |
| `project_deliverables.cdrl_item_id` | `project_cdrl_items.id` | 0% (0/3) ⚠️ |
| `project_deliverables.clin_id` | `project_clins.id` | 100% (3/3) |
| `project_deliverables.document_id` | `tenant_documents.id` | 0% (0/3) ⚠️ |
| `project_deliverables.milestone_id` | `project_milestones.id` | 100% (3/3) |
| `project_deliverables.submitted_by` | `users.id` | 0% (0/3) ⚠️ |
| `project_deliverables.tenant_id` | `tenants.id` | 100% (3/3) |
| `project_deliverables.uploaded_by` | `users.id` | 67% (2/3) ⚠️ |
| `project_invoice_lines.clin_id` | `project_clins.id` | — |
| `project_invoice_lines.invoice_id` | `project_invoices.id` | — |
| `project_invoice_lines.milestone_id` | `project_milestones.id` | — |
| `project_invoice_lines.tenant_id` | `tenants.id` | — |
| `project_invoices.created_by` | `users.id` | — |
| `project_invoices.document_id` | `tenant_documents.id` | — |
| `project_invoices.project_id` | `projects.id` | — |
| `project_invoices.tenant_id` | `tenants.id` | — |
| `project_meetings.created_by` | `users.id` | — |
| `project_meetings.document_id` | `tenant_documents.id` | — |
| `project_meetings.project_id` | `projects.id` | — |
| `project_meetings.tenant_id` | `tenants.id` | — |
| `project_milestone_tasks.assignee_user_id` | `users.id` | — |
| `project_milestone_tasks.completed_by` | `users.id` | — |
| `project_milestone_tasks.created_by` | `users.id` | — |
| `project_milestone_tasks.meeting_id` | `project_meetings.id` | — |
| `project_milestone_tasks.milestone_id` | `project_milestones.id` | — |
| `project_milestone_tasks.project_id` | `projects.id` | — |
| `project_milestone_tasks.tenant_id` | `tenants.id` | — |
| `project_milestones.clin_id` | `project_clins.id` | 100% (3/3) |
| `project_milestones.depends_on_id` | `project_milestones.id` | 0% (0/3) ⚠️ |
| `project_milestones.owner_user_id` | `users.id` | 0% (0/3) ⚠️ |
| `project_milestones.project_id` | `projects.id` | 100% (3/3) |
| `project_milestones.tenant_id` | `tenants.id` | 100% (3/3) |
| `project_modification_changes.clin_id` | `project_clins.id` | — |
| `project_modification_changes.modification_id` | `project_modifications.id` | — |
| `project_modification_changes.tenant_id` | `tenants.id` | — |
| `project_modifications.created_by` | `users.id` | — |
| `project_modifications.executed_by` | `users.id` | — |
| `project_modifications.project_id` | `projects.id` | — |
| `project_modifications.source_doc_id` | `project_source_documents.id` | — |
| `project_modifications.tenant_id` | `tenants.id` | — |
| `project_provenance.created_by` | `users.id` | 100% (3/3) |
| `project_provenance.project_id` | `projects.id` | 100% (3/3) |
| `project_provenance.source_doc_id` | `project_source_documents.id` | 100% (3/3) |
| `project_provenance.tenant_id` | `tenants.id` | 100% (3/3) |
| `project_reviews.decided_by` | `users.id` | — |
| `project_reviews.project_id` | `projects.id` | — |
| `project_reviews.requested_by` | `users.id` | — |
| `project_reviews.reviewer_user_id` | `users.id` | — |
| `project_reviews.tenant_id` | `tenants.id` | — |
| `project_risks.closed_by` | `users.id` | — |
| `project_risks.created_by` | `users.id` | — |
| `project_risks.milestone_id` | `project_milestones.id` | — |
| `project_risks.owner_user_id` | `users.id` | — |
| `project_risks.project_id` | `projects.id` | — |
| `project_risks.tenant_id` | `tenants.id` | — |
| `project_source_documents.project_id` | `projects.id` | 100% (2/2) |
| `project_source_documents.tenant_id` | `tenants.id` | 100% (2/2) |
| `project_source_documents.uploaded_by` | `users.id` | 100% (2/2) |
| `project_task_attachments.project_id` | `projects.id` | — |
| `project_task_attachments.task_id` | `project_milestone_tasks.id` | — |
| `project_task_attachments.tenant_id` | `tenants.id` | — |
| `project_task_attachments.uploaded_by` | `users.id` | — |
| `project_time_entries.approved_by` | `users.id` | — |
| `project_time_entries.invoice_line_id` | `project_invoice_lines.id` | — |
| `project_time_entries.milestone_id` | `project_milestones.id` | — |
| `project_time_entries.project_id` | `projects.id` | — |
| `project_time_entries.task_id` | `project_milestone_tasks.id` | — |
| `project_time_entries.tenant_id` | `tenants.id` | — |
| `project_time_entries.user_id` | `users.id` | — |
| `projects.closed_by` | `users.id` | 0% (0/1) ⚠️ |
| `projects.contract_id` | `contracts.id` | 0% (0/1) ⚠️ |
| `projects.created_by` | `users.id` | 100% (1/1) |
| `projects.tenant_id` | `tenants.id` | 100% (1/1) |
| `promo_codes.issued_by` | `users.id` | 94% (17/18) |
| `promo_codes.redeemed_by_tenant_id` | `tenants.id` | 22% (4/18) ⚠️ |
| `promo_codes.revoked_by` | `users.id` | 0% (0/18) ⚠️ |
| `proposal_activity_log.actor_id` | `users.id` | 100% (120/120) |
| `proposal_activity_log.proposal_id` | `proposals.id` | 100% (120/120) |
| `proposal_activity_log.section_id` | `proposal_sections.id` | 0% (0/120) ⚠️ |
| `proposal_activity_log.tenant_id` | `tenants.id` | 100% (120/120) |
| `proposal_amendment_flags.acknowledged_by` | `users.id` | 100% (9/9) |
| `proposal_amendment_flags.amendment_id` | `solicitation_amendments.id` | 100% (9/9) |
| `proposal_amendment_flags.proposal_id` | `proposals.id` | 100% (9/9) |
| `proposal_amendment_flags.tenant_id` | `tenants.id` | 100% (9/9) |
| `proposal_artifacts.locked_by` | `users.id` | 95% (21/22) |
| `proposal_artifacts.proposal_id` | `proposals.id` | 100% (22/22) |
| `proposal_collaborators.invited_by` | `users.id` | 100% (13/13) |
| `proposal_collaborators.proposal_id` | `proposals.id` | 100% (13/13) |
| `proposal_collaborators.user_id` | `users.id` | 100% (13/13) |
| `proposal_comments.proposal_id` | `proposals.id` | 100% (4/4) |
| `proposal_comments.section_id` | `proposal_sections.id` | 100% (4/4) |
| `proposal_comments.user_id` | `users.id` | 100% (4/4) |
| `proposal_compliance_matrix.proposal_id` | `proposals.id` | 100% (71/71) |
| `proposal_compliance_matrix.section_id` | `proposal_sections.id` | 100% (71/71) |
| `proposal_portals.created_by` | `users.id` | 100% (8/8) |
| `proposal_portals.proposal_id` | `proposals.id` | 100% (8/8) |
| `proposal_portals.tenant_id` | `tenants.id` | 100% (8/8) |
| `proposal_sections.accepted_by` | `users.id` | 96% (68/71) |
| `proposal_sections.artifact_id` | `proposal_artifacts.id` | 100% (71/71) |
| `proposal_sections.assigned_to` | `users.id` | 0% (0/71) ⚠️ |
| `proposal_sections.editing_by` | `users.id` | 0% (0/71) ⚠️ |
| `proposal_sections.last_modified_by` | `users.id` | 86% (61/71) ⚠️ |
| `proposal_sections.locked_by` | `users.id` | 96% (68/71) |
| `proposal_sections.proposal_id` | `proposals.id` | 100% (71/71) |
| `proposal_stage_history.changed_by` | `users.id` | 95% (20/21) |
| `proposal_stage_history.proposal_id` | `proposals.id` | 100% (21/21) |
| `proposal_supporting_docs.proposal_id` | `proposals.id` | 100% (9/9) |
| `proposal_supporting_docs.reviewed_by` | `users.id` | 0% (0/9) ⚠️ |
| `proposal_supporting_docs.tenant_id` | `tenants.id` | 100% (9/9) |
| `proposal_supporting_docs.uploaded_by` | `users.id` | 0% (0/9) ⚠️ |
| `proposals.last_modified_by` | `users.id` | 78% (7/9) ⚠️ |
| `proposals.opportunity_id` | `opportunities.id` | 100% (9/9) |
| `proposals.solicitation_id` | `curated_solicitations.id` | 89% (8/9) ⚠️ |
| `proposals.tenant_id` | `tenants.id` | 100% (9/9) |
| `purchases.opportunity_id` | `opportunities.id` | 100% (7/7) |
| `purchases.proposal_id` | `proposals.id` | 0% (0/7) ⚠️ |
| `purchases.tenant_id` | `tenants.id` | 100% (7/7) |
| `sbir_data_uploads.uploaded_by` | `users.id` | — |
| `scout_findings.match_opportunity_id` | `opportunities.id` | — |
| `scout_findings.reviewed_by` | `users.id` | — |
| `scout_findings.source_id` | `scout_sources.id` | — |
| `scout_runs.source_id` | `scout_sources.id` | — |
| `section_standards.created_by` | `users.id` | 0% (0/21) ⚠️ |
| `section_standards.parent_key` | `section_standards.key` | 48% (10/21) ⚠️ |
| `semantic_memories.previous_version` | `semantic_memories.id` | 0% (0/26) ⚠️ |
| `semantic_memories.tenant_id` | `tenants.id` | 100% (26/26) |
| `sessions.user_id` | `users.id` | — |
| `shadow_admin_grants.admin_user_id` | `users.id` | 0% (0/5) ⚠️ |
| `shadow_admin_grants.granted_by` | `users.id` | 100% (5/5) |
| `shadow_admin_grants.portal_id` | `proposal_portals.id` | 100% (5/5) |
| `shadow_admin_grants.revoked_by` | `users.id` | 0% (0/5) ⚠️ |
| `shadow_admin_grants.tenant_id` | `tenants.id` | 100% (5/5) |
| `solicitation_amendments.detected_by` | `users.id` | 100% (9/9) |
| `solicitation_amendments.document_id` | `solicitation_documents.id` | 0% (0/9) ⚠️ |
| `solicitation_amendments.reviewed_by` | `users.id` | 100% (9/9) |
| `solicitation_amendments.solicitation_id` | `curated_solicitations.id` | 100% (9/9) |
| `solicitation_annotations.actor_id` | `users.id` | 100% (56/56) |
| `solicitation_annotations.solicitation_id` | `curated_solicitations.id` | 100% (56/56) |
| `solicitation_compliance.solicitation_id` | `curated_solicitations.id` | 100% (20/20) |
| `solicitation_compliance.topic_id` | `opportunities.id` | 15% (3/20) ⚠️ |
| `solicitation_compliance.verified_by` | `users.id` | 20% (4/20) ⚠️ |
| `solicitation_compliance_drafts.created_by` | `users.id` | 100% (8/8) |
| `solicitation_compliance_drafts.landed_by` | `users.id` | 0% (0/8) ⚠️ |
| `solicitation_compliance_drafts.solicitation_id` | `curated_solicitations.id` | 100% (8/8) |
| `solicitation_documents.solicitation_id` | `curated_solicitations.id` | 100% (11/11) |
| `solicitation_documents.uploaded_by` | `users.id` | 100% (11/11) |
| `solicitation_outlines.created_by` | `users.id` | — |
| `solicitation_outlines.solicitation_id` | `curated_solicitations.id` | — |
| `solicitation_volumes.created_by` | `users.id` | 0% (0/22) ⚠️ |
| `solicitation_volumes.solicitation_id` | `curated_solicitations.id` | 100% (22/22) |
| `solicitation_volumes.topic_id` | `opportunities.id` | 68% (15/22) ⚠️ |
| `source_diffs.next_snapshot_id` | `source_snapshots.id` | — (0/0) |
| `source_diffs.prev_snapshot_id` | `source_snapshots.id` | — (0/0) |
| `source_diffs.profile_id` | `source_profiles.id` | — (0/0) |
| `source_diffs.region_id` | `source_regions.id` | — (0/0) |
| `source_diffs.reviewed_by` | `users.id` | — (0/0) |
| `source_profiles.created_by` | `users.id` | 0% (0/6) ⚠️ |
| `source_profiles.last_visited_by` | `users.id` | 17% (1/6) ⚠️ |
| `source_regions.profile_id` | `source_profiles.id` | — |
| `source_snapshots.profile_id` | `source_profiles.id` | — (0/0) |
| `source_snapshots.region_id` | `source_regions.id` | — (0/0) |
| `source_visits.profile_id` | `source_profiles.id` | 100% (1/1) |
| `source_visits.visited_by` | `users.id` | 100% (1/1) |
| `stage_completion_snapshots.completed_by` | `users.id` | 100% (4/4) |
| `stage_completion_snapshots.proposal_id` | `proposals.id` | 100% (4/4) |
| `stage_gate_requirements.met_by` | `users.id` | — |
| `stage_gate_requirements.proposal_id` | `proposals.id` | — |
| `system_events.parent_event_id` | `system_events.id` | 2% (1767/73876) ⚠️ |
| `system_events.tenant_id` | `tenants.id` | 21% (15270/73876) ⚠️ |
| `tasks.process_instance_id` | `process_instances.id` | 21% (60/287) ⚠️ |
| `tasks.tenant_id` | `tenants.id` | 77% (220/287) ⚠️ |
| `template_bridge.posted_by` | `users.id` | 9% (4/43) ⚠️ |
| `template_bridge.template_id` | `master_templates.id` | 100% (43/43) |
| `tenant_agent_config.tenant_id` | `tenants.id` | 100% (1/1) |
| `tenant_automation_policies.tenant_id` | `tenants.id` | — (0/0) |
| `tenant_bridge_cursor.tenant_id` | `tenants.id` | 100% (8/8) |
| `tenant_bucket_scores.bucket_id` | `tenant_spotlight_buckets.id` | 100% (430/430) |
| `tenant_bucket_scores.tenant_id` | `tenants.id` | 100% (430/430) |
| `tenant_documents.created_by` | `users.id` | 100% (12/12) |
| `tenant_documents.source_template_id` | `document_templates.id` | 0% (0/12) ⚠️ |
| `tenant_documents.tenant_id` | `tenants.id` | 100% (12/12) |
| `tenant_opportunity_cards.tenant_id` | `tenants.id` | 100% (688/688) |
| `tenant_opportunity_documents.tenant_id` | `tenants.id` | — (0/0) |
| `tenant_profiles.tenant_id` | `tenants.id` | 100% (2/2) |
| `tenant_spotlight_buckets.created_by` | `users.id` | 100% (5/5) |
| `tenant_spotlight_buckets.tenant_id` | `tenants.id` | 100% (5/5) |
| `tenant_template_cards.tenant_id` | `tenants.id` | 100% (312/312) |
| `tenants.owner_id` | `users.id` | 38% (3/8) ⚠️ |
| `tool_invocation_metrics.tenant_id` | `tenants.id` | 0% (0/77) ⚠️ |
| `triage_actions.actor_id` | `users.id` | 100% (28/28) |
| `triage_actions.solicitation_id` | `curated_solicitations.id` | 100% (28/28) |
| `user_memberships.created_by` | `users.id` | 59% (16/27) ⚠️ |
| `user_memberships.tenant_id` | `tenants.id` | 100% (27/27) |
| `user_memberships.user_id` | `users.id` | 100% (27/27) |
| `users.tenant_id` | `tenants.id` | 51% (24/47) ⚠️ |
| `vault_members.invited_by` | `users.id` | 100% (1/1) |
| `vault_members.tenant_id` | `tenants.id` | 100% (1/1) |
| `vault_members.user_id` | `users.id` | 0% (0/1) ⚠️ |
| `vault_members.vault_id` | `collaboration_vaults.id` | 100% (1/1) |
| `volume_required_items.template_id` | `document_templates.id` | 0% (0/69) ⚠️ |
| `volume_required_items.verified_by` | `users.id` | 0% (0/69) ⚠️ |
| `volume_required_items.volume_id` | `solicitation_volumes.id` | 100% (69/69) |
| `waitlist.contact_id` | `contacts.id` | — |

---

## 5. Isolation

RLS is live and two-layer (docs/RLS_CUTOVER.md). The app runs as `govtech_app`
(`NOBYPASSRLS`); `sqlBypass` is the owner connection for migrations and the few legitimate
cross-tenant admin reads. **PLATFORM SCOPE = `tenant_id IS NULL`** — and because the
policies are tenant-EQUALITY and NULL never equals anything, such a row is invisible AND
un-writable through the context-aware `sql`.

| table | tenant_id | RLS | forced |
|---|---|---|---|
| `agent_performance` | yes | yes | — |
| `agent_task_log` | yes | yes | **yes** |
| `agent_task_queue` | yes | yes | — |
| `agent_task_results` | — | yes | **yes** |
| `applications` | yes | — | — |
| `atom_embeddings` | yes | yes | **yes** |
| `atom_lineage` | — | yes | **yes** |
| `atom_members` | — | yes | **yes** |
| `atom_tags` | — | yes | **yes** |
| `canvas_versions` | — | yes | **yes** |
| `collaboration_vaults` | yes | yes | **yes** |
| `collaborator_stage_access` | — | yes | **yes** |
| `contracts` | yes | yes | — |
| `document_cocoons` | yes | yes | — |
| `document_templates` | yes | yes | — |
| `email_send_ledger` | yes | yes | **yes** |
| `email_suppressions` | — | yes | **yes** |
| `episodic_memories` | yes | yes | **yes** |
| `expert_time_bookings` | yes | yes | **yes** |
| `guardrail_templates` | yes | yes | **yes** |
| `library_atoms` | yes | yes | **yes** |
| `library_seed_jobs` | yes | yes | — |
| `notification_read_state` | yes | yes | — |
| `procedural_memories` | yes | yes | **yes** |
| `process_instance_transitions` | — | yes | **yes** |
| `process_instances` | yes | yes | — |
| `project_acceptance_evidence` | yes | yes | **yes** |
| `project_assignments` | yes | yes | **yes** |
| `project_cdrl_items` | yes | yes | **yes** |
| `project_clins` | yes | yes | **yes** |
| `project_comments` | yes | yes | **yes** |
| `project_deliverables` | yes | yes | **yes** |
| `project_invoice_lines` | yes | yes | **yes** |
| `project_invoices` | yes | yes | **yes** |
| `project_meetings` | yes | yes | **yes** |
| `project_milestone_tasks` | yes | yes | **yes** |
| `project_milestones` | yes | yes | **yes** |
| `project_modification_changes` | yes | yes | **yes** |
| `project_modifications` | yes | yes | **yes** |
| `project_provenance` | yes | yes | **yes** |
| `project_reviews` | yes | yes | **yes** |
| `project_risks` | yes | yes | **yes** |
| `project_source_documents` | yes | yes | **yes** |
| `project_task_attachments` | yes | yes | **yes** |
| `project_time_entries` | yes | yes | **yes** |
| `projects` | yes | yes | **yes** |
| `proposal_activity_log` | yes | yes | — |
| `proposal_amendment_flags` | yes | yes | — |
| `proposal_artifacts` | — | yes | **yes** |
| `proposal_collaborators` | — | yes | **yes** |
| `proposal_comments` | — | yes | **yes** |
| `proposal_compliance_matrix` | — | yes | **yes** |
| `proposal_portals` | yes | yes | **yes** |
| `proposal_sections` | — | yes | **yes** |
| `proposal_stage_history` | — | yes | **yes** |
| `proposal_supporting_docs` | yes | yes | — |
| `proposals` | yes | yes | **yes** |
| `purchases` | yes | yes | — |
| `semantic_memories` | yes | yes | **yes** |
| `shadow_admin_grants` | yes | yes | **yes** |
| `stage_completion_snapshots` | — | yes | **yes** |
| `stage_gate_requirements` | — | yes | **yes** |
| `system_events` | yes | — | — |
| `tasks` | yes | yes | — |
| `tenant_agent_config` | yes | yes | — |
| `tenant_automation_policies` | yes | yes | **yes** |
| `tenant_bridge_cursor` | yes | — | — |
| `tenant_bucket_scores` | yes | yes | **yes** |
| `tenant_documents` | yes | yes | — |
| `tenant_opportunity_cards` | yes | yes | **yes** |
| `tenant_opportunity_documents` | yes | yes | **yes** |
| `tenant_profiles` | yes | yes | **yes** |
| `tenant_spotlight_buckets` | yes | yes | **yes** |
| `tenant_template_cards` | yes | yes | **yes** |
| `tool_invocation_metrics` | yes | — | — |
| `user_memberships` | yes | — | — |
| `users` | yes | — | — |
| `vault_members` | yes | yes | **yes** |
