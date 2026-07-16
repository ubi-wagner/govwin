# DB_SCHEMAS.md — Complete Database Schema Reference

**Generated:** 2026-07-15 · **Source:** a clean apply of every migration in `db/migrations/`
(**001 → 108**) onto a throwaway PostgreSQL 16, then dumped from the live catalog.
**Authoritative** — this is the actual as-built schema, not hand-maintained.

- **112 tables + 2 views** in the main database (`govtech_intel`, shared by the Next.js frontend
  and the Python pipeline).
- **Format:** each column row is `Column | Type | NOT NULL / DEFAULT`; table-level
  `PRIMARY KEY` / `UNIQUE` / `FOREIGN KEY` / `CHECK` constraints and non-constraint `INDEX`es
  follow as trailing rows (empty Column/Type cells).
- **Row-Level Security:** tenant-scoped tables enforce RLS `FORCE` via a `tenant_isolation` policy
  on the `app.tenant_id` GUC (set per transaction by `withTenant()`, `frontend/lib/rls.ts`).
  Policies, triggers, and functions are not listed here — see the migrations for those.
- The **CMS/CRM** service has its own separate database (`govtech_cms`); its schema lives in
  `services/cms/db/` and is not included in this dump.
- Canonical design of the customer opportunity spine (bridge → cards → purchase → proposal):
  `docs/MASTER_MIRROR_OPP_DESIGN.md`. Column-name quick reference + recent deltas:
  `CLAUDE_CLIFFNOTES.md`.

> **To regenerate:** apply all migrations to a fresh DB and dump the catalog. This doc is produced
> mechanically from the live schema, so it stays exact across migrations rather than drifting.

---

## Main Postgres Database (govtech_intel)

### accounts

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| user_id | UUID | NOT NULL |
| type | TEXT | NOT NULL |
| provider | TEXT | NOT NULL |
| provider_account_id | TEXT | NOT NULL |
| refresh_token | TEXT |  |
| access_token | TEXT |  |
| expires_at | BIGINT |  |
| token_type | TEXT |  |
| scope | TEXT |  |
| id_token | TEXT |  |
| | | PRIMARY KEY (id) |
| | | UNIQUE (provider, provider_account_id) |
| | | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE |
| | | INDEX idx_accounts_user_id (user_id) |

### agent_archetypes

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| role_name | TEXT | NOT NULL |
| display_name | TEXT | NOT NULL |
| system_prompt | TEXT | NOT NULL |
| tools | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| max_tokens | INT | NOT NULL, DEFAULT 4096 |
| temperature | FLOAT8 | NOT NULL, DEFAULT 0.3 |
| human_gate | BOOLEAN | NOT NULL, DEFAULT true |
| memory_categories | TEXT[] | DEFAULT '{}'::text[] |
| guardrails | JSONB | DEFAULT '{}'::jsonb |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (role_name) |

### agent_performance

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| agent_role | TEXT | NOT NULL |
| period_start | DATE | NOT NULL |
| period_end | DATE | NOT NULL |
| tasks_completed | INT | DEFAULT 0 |
| acceptance_rate | FLOAT8 |  |
| avg_edit_pct | FLOAT8 |  |
| avg_cost_usd | NUMERIC(10,6) |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (tenant_id, agent_role, period_start) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |

### agent_task_log

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID |  |
| agent_role | TEXT | NOT NULL |
| task_type | TEXT | NOT NULL |
| trigger_event | TEXT |  |
| proposal_id | UUID |  |
| section_id | UUID |  |
| input_tokens | INT |  |
| output_tokens | INT |  |
| tool_calls_count | INT | DEFAULT 0 |
| duration_ms | INT |  |
| cost_usd | NUMERIC(10,6) |  |
| human_accepted | BOOLEAN |  |
| human_edit_pct | FLOAT8 |  |
| memories_retrieved | INT | DEFAULT 0 |
| memories_written | INT | DEFAULT 0 |
| error | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) |
| | | FOREIGN KEY (section_id) REFERENCES proposal_sections(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | INDEX idx_atl_created (created_at) |
| | | INDEX idx_atl_tenant (tenant_id) |
| | | INDEX idx_atl_tenant_created (tenant_id, created_at) |
| | | INDEX idx_atl_tenant_role (tenant_id, agent_role) |

### agent_task_queue

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| agent_role | TEXT | NOT NULL |
| task_type | TEXT | NOT NULL |
| input | JSONB | NOT NULL |
| proposal_id | UUID |  |
| section_id | UUID |  |
| status | TEXT | NOT NULL, DEFAULT 'pending'::text |
| worker_id | TEXT |  |
| picked_at | TIMESTAMPTZ |  |
| completed_at | TIMESTAMPTZ |  |
| error | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) |
| | | FOREIGN KEY (section_id) REFERENCES proposal_sections(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text]))) |
| | | INDEX idx_atq_status (status) WHERE (status = 'pending'::text) |

### agent_task_results

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| task_id | UUID | NOT NULL |
| output | JSONB | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (task_id) REFERENCES agent_task_queue(id) |

### api_key_registry

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| source | TEXT | NOT NULL |
| encrypted_key | TEXT |  |
| key_hint | TEXT |  |
| expires_at | TIMESTAMPTZ |  |
| last_validated | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (source) |

### applications

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| contact_email | TEXT | NOT NULL |
| contact_name | TEXT | NOT NULL |
| contact_title | TEXT |  |
| contact_phone | TEXT |  |
| company_name | TEXT | NOT NULL |
| company_website | TEXT |  |
| company_size | TEXT |  |
| company_state | TEXT |  |
| sam_registered | BOOLEAN |  |
| sam_cage_code | TEXT |  |
| duns_uei | TEXT |  |
| previous_submissions | INT |  |
| previous_awards | INT |  |
| previous_award_programs | TEXT[] |  |
| tech_summary | TEXT | NOT NULL |
| tech_areas | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| target_programs | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| target_agencies | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| desired_outcomes | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| motivation | TEXT |  |
| referral_source | TEXT |  |
| status | TEXT | NOT NULL, DEFAULT 'pending'::text |
| reviewed_by | UUID |  |
| reviewed_at | TIMESTAMPTZ |  |
| review_notes | TEXT |  |
| accepted_cohort | TEXT |  |
| terms_accepted_at | TIMESTAMPTZ | NOT NULL |
| terms_version | TEXT | NOT NULL, DEFAULT 'v1'::text |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| ip_hash | TEXT |  |
| user_agent | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (reviewed_by) REFERENCES users(id) |
| | | CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'accepted'::text, 'rejected'::text, 'onboarded'::text, 'withdrawn'::text]))) |
| | | INDEX idx_applications_accepted (created_at DESC) WHERE (status = 'accepted'::text) |
| | | UNIQUE INDEX idx_applications_email_unique (lower(contact_email)) |
| | | INDEX idx_applications_status (status, created_at DESC) WHERE (status = ANY (ARRAY['pending'::text, 'under_review'::text])) |

### atom_lineage

| Column | Type | Constraints |
|--------|------|-------------|
| parent_atom_id | UUID | NOT NULL |
| child_atom_id | UUID | NOT NULL |
| relation | TEXT | NOT NULL, DEFAULT 'derived_from'::text |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (parent_atom_id, child_atom_id) |
| | | FOREIGN KEY (child_atom_id) REFERENCES library_atoms(id) ON DELETE CASCADE |
| | | FOREIGN KEY (parent_atom_id) REFERENCES library_atoms(id) ON DELETE CASCADE |
| | | CHECK ((parent_atom_id <> child_atom_id)) |
| | | CHECK ((relation = ANY (ARRAY['derived_from'::text, 'reused_from'::text]))) |
| | | INDEX idx_lineage_child (child_atom_id) |
| | | INDEX idx_lineage_parent (parent_atom_id) |

### atom_members

| Column | Type | Constraints |
|--------|------|-------------|
| group_atom_id | UUID | NOT NULL |
| member_atom_id | UUID | NOT NULL |
| ordinal | INT | NOT NULL, DEFAULT 0 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (group_atom_id, member_atom_id) |
| | | FOREIGN KEY (group_atom_id) REFERENCES library_atoms(id) ON DELETE CASCADE |
| | | FOREIGN KEY (member_atom_id) REFERENCES library_atoms(id) ON DELETE CASCADE |
| | | CHECK ((group_atom_id <> member_atom_id)) |
| | | INDEX idx_members_group (group_atom_id, ordinal) |

### atom_tags

| Column | Type | Constraints |
|--------|------|-------------|
| atom_id | UUID | NOT NULL |
| dimension | TEXT | NOT NULL |
| value | TEXT | NOT NULL |
| is_other | BOOLEAN | NOT NULL, DEFAULT false |
| tag_source | TEXT | NOT NULL, DEFAULT 'admin'::text |
| confirmed | BOOLEAN | NOT NULL, DEFAULT false |
| confirmed_by | UUID |  |
| confirmed_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (atom_id, dimension, value) |
| | | FOREIGN KEY (atom_id) REFERENCES library_atoms(id) ON DELETE CASCADE |
| | | FOREIGN KEY (confirmed_by) REFERENCES users(id) |
| | | CHECK ((tag_source = ANY (ARRAY['auto'::text, 'admin'::text]))) |
| | | INDEX idx_atom_tags_dimval (dimension, value) |

### audit_log

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID |  |
| user_id | UUID |  |
| action | TEXT | NOT NULL |
| entity_type | TEXT |  |
| entity_id | TEXT |  |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | FOREIGN KEY (user_id) REFERENCES users(id) |

### automation_log

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| rule_id | UUID |  |
| trigger_event_id | UUID |  |
| action_taken | TEXT |  |
| result | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| action_type | TEXT | NOT NULL, DEFAULT ''::text |
| status | TEXT | NOT NULL, DEFAULT 'success'::text |
| error_message | TEXT |  |
| executed_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (rule_id) REFERENCES automation_rules(id) |
| | | CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text, 'skipped'::text]))) |
| | | INDEX idx_automation_log_rule (rule_id, executed_at DESC) |

### automation_rules

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| conditions | JSONB | DEFAULT '{}'::jsonb |
| action_type | TEXT | NOT NULL |
| action_config | JSONB | DEFAULT '{}'::jsonb |
| cooldown_minutes | INT | DEFAULT 0 |
| max_fires_per_hour | INT | DEFAULT 100 |
| enabled | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| description | TEXT |  |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| trigger_namespace | TEXT | NOT NULL, DEFAULT ''::text |
| trigger_type | TEXT | NOT NULL, DEFAULT ''::text |
| created_by | UUID |  |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (name) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | CHECK ((action_type = ANY (ARRAY['log_only'::text, 'queue_notification'::text, 'queue_job'::text, 'emit_event'::text, 'send_email'::text, 'notify_admin'::text, 'webhook'::text, 'update_status'::text, 'create_todo'::text, 'distribute_social'::text, 'publish_content'::text, 'unpublish_content'::text, 'enroll_drip'::text]))) |
| | | UNIQUE INDEX idx_automation_rules_name (name) |
| | | INDEX idx_automation_rules_trigger (trigger_namespace, trigger_type) WHERE (is_active = true) |

### canvas_versions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| section_id | UUID | NOT NULL |
| version_number | INT | NOT NULL |
| content | JSONB | NOT NULL |
| snapshot_reason | TEXT |  |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| source | TEXT | NOT NULL, DEFAULT 'human_edit'::text |
| ai_instruction | TEXT |  |
| ai_model | TEXT |  |
| parent_version_id | UUID |  |
| char_count | INT |  |
| word_count | INT |  |
| edit_summary | TEXT |  |
| | | PRIMARY KEY (id) |
| | | UNIQUE (section_id, version_number) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | FOREIGN KEY (parent_version_id) REFERENCES canvas_versions(id) |
| | | FOREIGN KEY (section_id) REFERENCES proposal_sections(id) ON DELETE CASCADE |
| | | CHECK ((source = ANY (ARRAY['ai_draft'::text, 'human_edit'::text, 'ai_revision'::text, 'library_import'::text, 'template'::text, 'system'::text]))) |
| | | INDEX idx_canvas_versions_section (section_id, version_number DESC) |
| | | INDEX idx_cv_source (source) |

### cms_content

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| slug | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| content_type | TEXT | NOT NULL |
| body | TEXT | NOT NULL |
| excerpt | TEXT |  |
| author | TEXT |  |
| tags | TEXT[] | DEFAULT '{}'::text[] |
| published | BOOLEAN | NOT NULL, DEFAULT false |
| published_at | TIMESTAMPTZ |  |
| featured_image | TEXT |  |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| external_url | TEXT |  |
| display_order | INT | DEFAULT 0 |
| status | TEXT | NOT NULL, DEFAULT 'draft'::text |
| | | PRIMARY KEY (id) |
| | | UNIQUE (slug) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | CHECK ((content_type = ANY (ARRAY['blog_post'::text, 'resource'::text, 'guide'::text, 'announcement'::text, 'faq'::text, 'testimonial'::text, 'team_member'::text, 'social_post'::text, 'page_block'::text]))) |
| | | CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'published'::text, 'private'::text, 'archived'::text]))) |
| | | INDEX idx_cms_content_slug (slug) |
| | | INDEX idx_cms_content_status (status) |
| | | INDEX idx_cms_content_tags (tags) |
| | | INDEX idx_cms_content_type_published (content_type, published_at DESC) WHERE (published = true) |

### collaborator_library_prefs

| Column | Type | Constraints |
|--------|------|-------------|
| owner_user_id | UUID | NOT NULL |
| tenant_id | UUID | NOT NULL |
| share_default | TEXT | NOT NULL, DEFAULT 'restrict_until_approved'::text |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (owner_user_id, tenant_id) |
| | | FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE |
| | | CHECK ((share_default = ANY (ARRAY['share_all'::text, 'restrict_until_approved'::text]))) |

### collaborator_stage_access

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| collaborator_id | UUID | NOT NULL |
| proposal_id | UUID | NOT NULL |
| stage | TEXT | NOT NULL |
| artifact_types | TEXT[] | DEFAULT '{}'::text[] |
| permission | TEXT | NOT NULL, DEFAULT 'view'::text |
| access_granted_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| access_revoked_at | TIMESTAMPTZ |  |
| granted_by | UUID |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (collaborator_id) REFERENCES proposal_collaborators(id) |
| | | FOREIGN KEY (granted_by) REFERENCES users(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | CHECK ((permission = ANY (ARRAY['view'::text, 'comment'::text, 'edit'::text]))) |
| | | INDEX idx_csa_collab (collaborator_id) |
| | | INDEX idx_csa_proposal_stage (proposal_id, stage) |

### compliance_presets

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| phase_type | TEXT | NOT NULL |
| agency | TEXT |  |
| program_type | TEXT |  |
| compliance_data | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| volumes_data | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| is_system | BOOLEAN | DEFAULT false |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | UNIQUE INDEX idx_compliance_presets_name_phase (name, phase_type) |

### compliance_variables

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| label | TEXT | NOT NULL |
| category | TEXT | NOT NULL |
| data_type | TEXT | NOT NULL, DEFAULT 'text'::text |
| options | JSONB |  |
| is_system | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (name) |
| | | CHECK ((data_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'select'::text, 'multiselect'::text]))) |

### consent_records

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| user_id | UUID | NOT NULL |
| document_type | TEXT | NOT NULL |
| document_version | TEXT | NOT NULL |
| accepted_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| ip_address | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (user_id) REFERENCES users(id) |

### content_events

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| event_type | TEXT | NOT NULL |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| processed | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |

### content_pages

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| page_key | TEXT | NOT NULL |
| content_type | TEXT | NOT NULL, DEFAULT 'page'::text |
| version_no | INT | NOT NULL, DEFAULT 1 |
| status | TEXT | NOT NULL, DEFAULT 'draft'::text |
| title | TEXT |  |
| blocks | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| audit_note | TEXT |  |
| created_by | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| published_at | TIMESTAMPTZ |  |
| archived_at | TIMESTAMPTZ |  |
| | | PRIMARY KEY (id) |
| | | CHECK ((content_type = ANY (ARRAY['page'::text, 'blog_post'::text, 'resource'::text, 'guide'::text, 'testimonial'::text, 'team_member'::text]))) |
| | | CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text]))) |
| | | INDEX idx_content_pages_page_key (page_key, version_no DESC) |
| | | UNIQUE INDEX uq_content_pages_active (content_type, page_key) WHERE (status = 'active'::text) |

### contracts

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| opportunity_id | UUID | NOT NULL |
| proposal_id | UUID |  |
| title | TEXT | NOT NULL |
| status | TEXT | NOT NULL, DEFAULT 'active'::text |
| award_date | TIMESTAMPTZ | DEFAULT now() |
| award_amount_cents | BIGINT |  |
| pop_start | DATE |  |
| pop_end | DATE |  |
| origin_card | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE |
| | | CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'terminated'::text]))) |
| | | INDEX idx_contracts_opportunity (opportunity_id) |
| | | INDEX idx_contracts_tenant (tenant_id) |
| | | UNIQUE INDEX uq_contracts_proposal (proposal_id) WHERE (proposal_id IS NOT NULL) |

### curated_solicitations

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| opportunity_id | UUID | NOT NULL |
| namespace | TEXT | NOT NULL |
| status | TEXT | NOT NULL, DEFAULT 'new'::text |
| claimed_by | UUID |  |
| claimed_at | TIMESTAMPTZ |  |
| curated_by | UUID |  |
| approved_by | UUID |  |
| pushed_at | TIMESTAMPTZ |  |
| dismissed_reason | TEXT |  |
| phase_like | TEXT |  |
| ai_extracted | JSONB |  |
| ai_confidence | FLOAT8 |  |
| ai_similar_to | UUID |  |
| ai_similarity_score | FLOAT8 |  |
| full_text | TEXT |  |
| full_text_tsv | TSVECTOR | DEFAULT to_tsvector('english'::regconfig, COALESCE(full_text, ''::text)) |
| annotations | JSONB | DEFAULT '[]'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| review_requested_for | UUID |  |
| solicitation_type | TEXT | DEFAULT 'single'::text |
| solicitation_title | TEXT |  |
| solicitation_number | TEXT |  |
| round_number | INT |  |
| round_label | TEXT |  |
| intake_meta | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| spotlight_summary | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (ai_similar_to) REFERENCES curated_solicitations(id) |
| | | FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL |
| | | FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL |
| | | FOREIGN KEY (curated_by) REFERENCES users(id) ON DELETE SET NULL |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) |
| | | FOREIGN KEY (review_requested_for) REFERENCES users(id) |
| | | CHECK ((phase_like = ANY (ARRAY['phase_1'::text, 'phase_2'::text]))) |
| | | CHECK ((solicitation_type = ANY (ARRAY['single'::text, 'multi_topic'::text]))) |
| | | CHECK ((status = ANY (ARRAY['new'::text, 'claimed'::text, 'released'::text, 'released_for_analysis'::text, 'ai_analyzed'::text, 'shredder_failed'::text, 'curation_in_progress'::text, 'review_requested'::text, 'approved'::text, 'pushed_to_pipeline'::text, 'dismissed'::text, 'rejected_review'::text]))) |
| | | INDEX idx_csol_fts (full_text_tsv) |
| | | INDEX idx_csol_my_claims (claimed_by, claimed_at DESC) WHERE (status = ANY (ARRAY['claimed'::text, 'curation_in_progress'::text, 'review_requested'::text])) |
| | | INDEX idx_csol_namespace (namespace) |
| | | INDEX idx_csol_opp (opportunity_id) |
| | | INDEX idx_csol_status (status) |
| | | INDEX idx_csol_triage_unclaimed (created_at DESC) WHERE ((status = 'new'::text) AND (claimed_by IS NULL)) |

### curation_revisions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL |
| actor_id | UUID |  |
| actor_email | TEXT |  |
| revision_type | TEXT | NOT NULL |
| field_name | TEXT |  |
| old_value | TEXT |  |
| new_value | TEXT |  |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (actor_id) REFERENCES users(id) |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) ON DELETE CASCADE |
| | | CHECK ((revision_type = ANY (ARRAY['compliance_updated'::text, 'annotation_added'::text, 'annotation_removed'::text, 'outline_updated'::text, 'volume_added'::text, 'volume_removed'::text, 'item_added'::text, 'item_updated'::text, 'item_removed'::text, 'document_uploaded'::text, 'ai_extracted'::text, 'review_requested'::text, 'review_approved'::text, 'review_rejected'::text, 'status_changed'::text, 'namespace_set'::text]))) |
| | | INDEX idx_cr_actor (actor_id) |
| | | INDEX idx_cr_solicitation (solicitation_id, created_at DESC) |

### customer_events

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| event_type | TEXT | NOT NULL |
| tenant_id | UUID |  |
| user_id | UUID |  |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| processed | BOOLEAN | NOT NULL, DEFAULT false |
| processed_by | TEXT |  |
| processed_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | FOREIGN KEY (user_id) REFERENCES users(id) |

### deploy_baseline

| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | NOT NULL |
| note | TEXT |  |
| recorded_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |

### document_cocoons

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID |  |
| name | TEXT | NOT NULL |
| program_type | TEXT |  |
| scope | TEXT | NOT NULL, DEFAULT 'section'::text |
| structure | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| origin_proposal_id | UUID |  |
| source | TEXT | NOT NULL, DEFAULT 'system'::text |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((scope = ANY (ARRAY['section'::text, 'document'::text]))) |
| | | CHECK ((source = ANY (ARRAY['upload'::text, 'download'::text, 'system'::text, 'harvest'::text]))) |
| | | INDEX idx_cocoons_tenant (tenant_id) |

### document_templates

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| description | TEXT |  |
| template_type | TEXT | NOT NULL |
| agency | TEXT |  |
| program_type | TEXT |  |
| storage_key | TEXT |  |
| canvas_preset | JSONB | NOT NULL |
| node_count | INT | DEFAULT 0 |
| is_system | BOOLEAN | NOT NULL, DEFAULT false |
| tenant_id | UUID |  |
| created_by | UUID |  |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| canvas_document | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((template_type = ANY (ARRAY['technical_volume'::text, 'cost_volume'::text, 'slide_deck'::text, 'past_performance'::text, 'key_personnel'::text, 'commercialization'::text, 'abstract'::text, 'cover_sheet'::text, 'supporting_docs'::text, 'custom'::text]))) |
| | | UNIQUE INDEX idx_document_templates_name (name) WHERE (is_system = true) |
| | | INDEX idx_templates_tenant (tenant_id, template_type) WHERE (tenant_id IS NOT NULL) |
| | | INDEX idx_templates_type_agency (template_type, agency) WHERE (is_system = true) |

### episodic_memories

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| agent_role | TEXT | NOT NULL |
| embedding | VECTOR(1536) | NOT NULL |
| content | TEXT | NOT NULL |
| memory_type | TEXT | NOT NULL, DEFAULT 'observation'::text |
| importance | FLOAT8 | NOT NULL, DEFAULT 0.5 |
| entities | JSONB | DEFAULT '[]'::jsonb |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| source | TEXT |  |
| occurred_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| last_accessed | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| access_count | INT | NOT NULL, DEFAULT 0 |
| decay_factor | FLOAT8 | NOT NULL, DEFAULT 1.0 |
| is_archived | BOOLEAN | NOT NULL, DEFAULT false |
| superseded_by | UUID |  |
| namespace | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (superseded_by) REFERENCES episodic_memories(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((memory_type = ANY (ARRAY['observation'::text, 'interaction'::text, 'decision'::text, 'outcome'::text]))) |
| | | INDEX idx_em_archived (is_archived) WHERE (NOT is_archived) |
| | | INDEX idx_em_embedding (embedding vector_cosine_ops) WITH (m='16', ef_construction='128') |
| | | INDEX idx_em_entities (entities) |
| | | INDEX idx_em_tenant (tenant_id) |
| | | INDEX idx_em_tenant_role (tenant_id, agent_role) |
| | | INDEX idx_episodic_namespace (namespace text_pattern_ops) WHERE (namespace IS NOT NULL) |

### guardrail_templates

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID |  |
| name | TEXT | NOT NULL |
| description | TEXT |  |
| config | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| is_default | BOOLEAN | NOT NULL, DEFAULT false |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | INDEX idx_gt_tenant (tenant_id) |

### invitations

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| email | TEXT | NOT NULL |
| role | TEXT | NOT NULL, DEFAULT 'tenant_user'::text |
| token | TEXT | NOT NULL |
| invited_by | UUID |  |
| accepted_at | TIMESTAMPTZ |  |
| expires_at | TIMESTAMPTZ | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (token) |
| | | FOREIGN KEY (invited_by) REFERENCES users(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |

### legal_document_versions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| document_type | TEXT | NOT NULL |
| version | TEXT | NOT NULL |
| content_hash | TEXT |  |
| effective_date | DATE | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (document_type, version) |

### library_atom_outcomes

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| unit_id | UUID | NOT NULL |
| proposal_id | UUID | NOT NULL |
| outcome | TEXT |  |
| recorded_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (unit_id, proposal_id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) |
| | | FOREIGN KEY (unit_id) REFERENCES library_units(id) |
| | | CHECK ((outcome = ANY (ARRAY['win'::text, 'loss'::text, 'pending'::text]))) |

### library_atoms

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| grain | TEXT | NOT NULL, DEFAULT 'primitive'::text |
| title | TEXT |  |
| content | TEXT |  |
| canvas_nodes | JSONB |  |
| summary | TEXT |  |
| word_count | INT | NOT NULL, DEFAULT 0 |
| char_count | INT | NOT NULL, DEFAULT 0 |
| member_summary | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| status | TEXT | NOT NULL, DEFAULT 'draft'::text |
| confidence | REAL | NOT NULL, DEFAULT 0.5 |
| outcome | TEXT | NOT NULL, DEFAULT 'pending'::text |
| outcome_score | REAL | NOT NULL, DEFAULT 0.5 |
| usage_count | INT | NOT NULL, DEFAULT 0 |
| source | TEXT | NOT NULL, DEFAULT 'upload'::text |
| cocoon_id | UUID |  |
| origin_proposal_id | UUID |  |
| origin_section_id | UUID |  |
| embedding | VECTOR(1536) |  |
| owner_user_id | UUID |  |
| visibility | TEXT | NOT NULL, DEFAULT 'tenant'::text |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| creator_kind | TEXT | NOT NULL, DEFAULT 'admin'::text |
| created_by | UUID |  |
| source_anchor | JSONB |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (cocoon_id) REFERENCES document_cocoons(id) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | FOREIGN KEY (owner_user_id) REFERENCES users(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((creator_kind = ANY (ARRAY['admin'::text, 'ai'::text, 'collaborator'::text, 'system'::text, 'import'::text]))) |
| | | CHECK ((grain = ANY (ARRAY['primitive'::text, 'group'::text, 'reference'::text]))) |
| | | CHECK ((outcome = ANY (ARRAY['pending'::text, 'awarded'::text, 'rejected'::text, 'withdrawn'::text]))) |
| | | CHECK ((source = ANY (ARRAY['upload'::text, 'harvest'::text, 'download_derivative'::text, 'manual'::text]))) |
| | | CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'archived'::text]))) |
| | | CHECK ((visibility = ANY (ARRAY['tenant'::text, 'owner_only'::text, 'shared_for_proposal'::text, 'admin_only'::text]))) |
| | | INDEX idx_atoms_grain (tenant_id, grain) |
| | | INDEX idx_atoms_tenant (tenant_id) |
| | | INDEX idx_atoms_tenant_status (tenant_id, status) |

### library_harvest_log

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| proposal_id | UUID |  |
| unit_id | UUID |  |
| harvested_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | FOREIGN KEY (unit_id) REFERENCES library_units(id) |

### library_unit_shares

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| unit_id | UUID | NOT NULL |
| proposal_id | UUID | NOT NULL |
| approved_by | UUID |  |
| approved_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (unit_id, proposal_id) |
| | | FOREIGN KEY (approved_by) REFERENCES users(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | FOREIGN KEY (unit_id) REFERENCES library_units(id) ON DELETE CASCADE |
| | | INDEX idx_lus_proposal (proposal_id) |
| | | INDEX idx_lus_unit (unit_id) |

### library_units

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| content | TEXT | NOT NULL |
| category | TEXT | NOT NULL |
| subcategory | TEXT |  |
| tags | TEXT[] | DEFAULT '{}'::text[] |
| embedding | VECTOR(1536) |  |
| confidence | FLOAT8 | NOT NULL, DEFAULT 0.5 |
| status | TEXT | NOT NULL, DEFAULT 'draft'::text |
| source_type | TEXT | DEFAULT 'manual'::text |
| source_id | TEXT |  |
| usage_count | INT | NOT NULL, DEFAULT 0 |
| parent_unit_id | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| outcome | TEXT |  |
| outcome_score | REAL | DEFAULT 0.5 |
| original_proposal_id | UUID |  |
| original_node_id | TEXT |  |
| atom_hash | TEXT |  |
| canvas_nodes | JSONB |  |
| document_metadata | JSONB | DEFAULT '{}'::jsonb |
| source_filename | TEXT |  |
| source_storage_key | TEXT |  |
| heading_text | TEXT |  |
| char_offset | INT |  |
| char_length | INT |  |
| is_seminal | BOOLEAN | DEFAULT false |
| meta | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| owner_user_id | UUID |  |
| visibility | TEXT | NOT NULL, DEFAULT 'tenant'::text |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (owner_user_id) REFERENCES users(id) |
| | | FOREIGN KEY (parent_unit_id) REFERENCES library_units(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((outcome = ANY (ARRAY['pending'::text, 'awarded'::text, 'rejected'::text, 'withdrawn'::text]))) |
| | | CHECK ((source_type = ANY (ARRAY['manual'::text, 'upload'::text, 'harvest'::text, 'ai'::text]))) |
| | | CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'archived'::text]))) |
| | | CHECK ((visibility = ANY (ARRAY['tenant'::text, 'owner_only'::text, 'shared_for_proposal'::text]))) |
| | | INDEX idx_library_embedding (embedding vector_cosine_ops) WITH (m='16', ef_construction='128') |
| | | INDEX idx_library_parent (parent_unit_id) WHERE (parent_unit_id IS NOT NULL) |
| | | INDEX idx_library_seminal (tenant_id, is_seminal) WHERE (is_seminal = true) |
| | | INDEX idx_library_status (status) WHERE (status = 'approved'::text) |
| | | INDEX idx_library_tenant (tenant_id) |
| | | INDEX idx_library_tenant_cat (tenant_id, category) |
| | | INDEX idx_library_tenant_subcat (tenant_id, subcategory) WHERE (subcategory IS NOT NULL) |
| | | INDEX idx_library_units_outcome (outcome_score DESC) WHERE (outcome = 'awarded'::text) |
| | | INDEX idx_library_units_owner (owner_user_id) WHERE (owner_user_id IS NOT NULL) |

### opportunities

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| source | TEXT | NOT NULL |
| source_id | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| agency | TEXT |  |
| office | TEXT |  |
| solicitation_number | TEXT |  |
| naics_codes | TEXT[] | DEFAULT '{}'::text[] |
| classification_code | TEXT |  |
| set_aside_type | TEXT |  |
| program_type | TEXT |  |
| close_date | TIMESTAMPTZ |  |
| posted_date | TIMESTAMPTZ |  |
| estimated_value_min | NUMERIC |  |
| estimated_value_max | NUMERIC |  |
| description | TEXT |  |
| content_hash | TEXT |  |
| full_text_tsv | TSVECTOR |  |
| award_date | TIMESTAMPTZ |  |
| award_amount | NUMERIC |  |
| awardee | TEXT |  |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| solicitation_id | UUID |  |
| topic_number | TEXT |  |
| topic_branch | TEXT |  |
| topic_status | TEXT | DEFAULT 'open'::text |
| tech_focus_areas | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| poc_name | TEXT |  |
| poc_email | TEXT |  |
| topic_metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| phase_type | TEXT |  |
| lifecycle_status | TEXT | NOT NULL, DEFAULT 'open'::text |
| closed_at | TIMESTAMPTZ |  |
| closed_reason | TEXT |  |
| reopened_at | TIMESTAMPTZ |  |
| close_date_changed_at | TIMESTAMPTZ |  |
| previous_close_date | TIMESTAMPTZ |  |
| submission_stage | TEXT | NOT NULL, DEFAULT 'open'::text |
| open_date | TIMESTAMPTZ |  |
| pre_release_date | TIMESTAMPTZ |  |
| org_unit | TEXT |  |
| expert_notes | TEXT |  |
| built_by | UUID |  |
| released_by | UUID |  |
| released_at | TIMESTAMPTZ |  |
| | | PRIMARY KEY (id) |
| | | UNIQUE (content_hash) |
| | | UNIQUE (source, source_id) |
| | | FOREIGN KEY (built_by) REFERENCES users(id) |
| | | FOREIGN KEY (released_by) REFERENCES users(id) |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) ON DELETE SET NULL |
| | | CHECK ((lifecycle_status = ANY (ARRAY['open'::text, 'closed'::text, 'archived'::text]))) |
| | | CHECK ((phase_type = ANY (ARRAY['phase_1'::text, 'phase_2'::text, 'direct_to_phase_2'::text, 'phase_3'::text, 'cso'::text, 'ota'::text, 'baa'::text, 'other'::text]))) |
| | | CHECK ((submission_stage = ANY (ARRAY['nofo'::text, 'pre_release'::text, 'open'::text, 'updated'::text, 'closed'::text, 'archived'::text]))) |
| | | CHECK ((topic_status = ANY (ARRAY['open'::text, 'pre_release'::text, 'closed'::text, 'awarded'::text, 'withdrawn'::text]))) |
| | | INDEX idx_opp_active (is_active) WHERE is_active |
| | | INDEX idx_opp_agency (agency) |
| | | INDEX idx_opp_close (close_date) |
| | | INDEX idx_opp_fts (full_text_tsv) |
| | | INDEX idx_opp_lifecycle (lifecycle_status) WHERE (lifecycle_status <> 'open'::text) |
| | | INDEX idx_opp_source (source, source_id) |
| | | INDEX idx_opp_submission_stage (submission_stage) WHERE (submission_stage <> 'open'::text) |
| | | INDEX idx_opps_solicitation (solicitation_id, topic_number) WHERE (solicitation_id IS NOT NULL) |
| | | INDEX idx_opps_topic_status (topic_status) WHERE (topic_status <> 'closed'::text) |

### opportunity_bridge

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| opportunity_id | UUID | NOT NULL |
| version | INT | NOT NULL |
| event_type | TEXT | NOT NULL |
| card | JSONB | NOT NULL |
| posted_by | UUID |  |
| posted_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (opportunity_id, version) |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) |
| | | FOREIGN KEY (posted_by) REFERENCES users(id) |
| | | CHECK ((event_type = ANY (ARRAY['published'::text, 'updated'::text, 'closed'::text, 'reopened'::text, 'awarded'::text, 'archived'::text]))) |
| | | INDEX idx_oppbridge_id_seq (posted_at, id) |
| | | INDEX idx_oppbridge_opp (opportunity_id, version DESC) |
| | | INDEX idx_oppbridge_posted (posted_at) |

### opportunity_events

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| event_type | TEXT | NOT NULL |
| opportunity_id | UUID |  |
| source | TEXT |  |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| processed | BOOLEAN | NOT NULL, DEFAULT false |
| processed_by | TEXT |  |
| processed_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) |

### opportunity_lifecycle_actions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| opportunity_id | UUID | NOT NULL |
| actor_id | UUID |  |
| action | TEXT | NOT NULL |
| from_status | TEXT |  |
| to_status | TEXT |  |
| reason | TEXT |  |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (actor_id) REFERENCES users(id) |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE |
| | | CHECK ((action = ANY (ARRAY['close'::text, 'reopen'::text, 'archive'::text, 'close_date_change'::text, 'set_stage'::text]))) |
| | | INDEX idx_opp_lifecycle_actions (opportunity_id, created_at DESC) |

### page_views

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| session_id | TEXT | NOT NULL |
| page_path | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| duration_ms | INT |  |
| referrer | TEXT |  |
| utm_source | TEXT |  |
| utm_medium | TEXT |  |
| utm_campaign | TEXT |  |
| | | PRIMARY KEY (id) |
| | | INDEX idx_page_views_created_at (created_at) |
| | | INDEX idx_page_views_session_id (session_id) |

### pipeline_jobs

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| source | TEXT | NOT NULL |
| run_type | TEXT | NOT NULL, DEFAULT 'full'::text |
| status | TEXT | NOT NULL, DEFAULT 'pending'::text |
| worker_id | TEXT |  |
| result | JSONB |  |
| error | TEXT |  |
| started_at | TIMESTAMPTZ |  |
| completed_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| priority | INT | NOT NULL, DEFAULT 5 |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| kind | TEXT | NOT NULL, DEFAULT 'ingest'::text |
| | | PRIMARY KEY (id) |
| | | CHECK ((kind = ANY (ARRAY['ingest'::text, 'shred_solicitation'::text, 'scout_source'::text, 'draft_section'::text, 'review_section'::text, 'expand_topics'::text]))) |
| | | CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text]))) |
| | | INDEX idx_pipeline_jobs_pending_by_kind (kind, priority DESC, created_at) WHERE (status = 'pending'::text) |
| | | INDEX idx_pipeline_jobs_pending_queue (priority DESC, created_at) WHERE (status = 'pending'::text) |
| | | INDEX idx_pj_status (status) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text])) |

### pipeline_runs

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| job_id | UUID |  |
| source | TEXT | NOT NULL |
| run_type | TEXT | NOT NULL |
| metrics | JSONB | DEFAULT '{}'::jsonb |
| started_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| completed_at | TIMESTAMPTZ |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (job_id) REFERENCES pipeline_jobs(id) |

### pipeline_schedules

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| source | TEXT | NOT NULL |
| run_type | TEXT | NOT NULL, DEFAULT 'full'::text |
| cron_expression | TEXT | NOT NULL |
| enabled | BOOLEAN | NOT NULL, DEFAULT true |
| next_run_at | TIMESTAMPTZ |  |
| last_run_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (source) |

### platform_agent_config

| Column | Type | Constraints |
|--------|------|-------------|
| id | BOOLEAN | NOT NULL, DEFAULT true |
| default_monthly_budget | NUMERIC(10,2) | NOT NULL, DEFAULT 50.00 |
| default_rate_limit_per_hour | INT | NOT NULL, DEFAULT 50 |
| default_per_call_ceiling | NUMERIC(10,4) | NOT NULL, DEFAULT 0.50 |
| platform_monthly_cap | NUMERIC(12,2) |  |
| ai_enabled | BOOLEAN | NOT NULL, DEFAULT true |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_by | UUID |  |
| | | PRIMARY KEY (id) |
| | | CHECK ((id = true)) |

### procedural_memories

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| agent_role | TEXT | NOT NULL |
| embedding | VECTOR(1536) | NOT NULL |
| name | TEXT | NOT NULL |
| description | TEXT | NOT NULL |
| steps | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| trigger_conditions | JSONB | DEFAULT '{}'::jsonb |
| success_rate | FLOAT8 | DEFAULT 0.5 |
| execution_count | INT | NOT NULL, DEFAULT 0 |
| last_executed | TIMESTAMPTZ |  |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| namespace | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | INDEX idx_pm_active (is_active) WHERE is_active |
| | | INDEX idx_pm_embedding (embedding vector_cosine_ops) WITH (m='16', ef_construction='128') |
| | | INDEX idx_pm_tenant (tenant_id) |
| | | INDEX idx_procedural_namespace (namespace text_pattern_ops) WHERE (namespace IS NOT NULL) |

### process_instance_transitions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| instance_id | UUID | NOT NULL |
| from_status | TEXT |  |
| to_status | TEXT | NOT NULL |
| step_name | TEXT |  |
| actor | TEXT |  |
| reason | TEXT |  |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| affected_entity_type | TEXT |  |
| affected_entity_id | UUID |  |
| content_version_before | INT |  |
| content_version_after | INT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (instance_id) REFERENCES process_instances(id) ON DELETE CASCADE |
| | | INDEX idx_pit_instance (instance_id, created_at DESC) |

### process_instances

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| workflow_name | TEXT | NOT NULL |
| trigger_event_id | UUID |  |
| correlation_id | UUID | DEFAULT gen_random_uuid() |
| status | TEXT | NOT NULL, DEFAULT 'pending'::text |
| current_step | TEXT |  |
| current_step_index | INT | DEFAULT 0 |
| step_results | JSONB | DEFAULT '{}'::jsonb |
| step_status | JSONB | DEFAULT '{}'::jsonb |
| started_at | TIMESTAMPTZ |  |
| completed_at | TIMESTAMPTZ |  |
| last_heartbeat_at | TIMESTAMPTZ | DEFAULT now() |
| deadline | TIMESTAMPTZ |  |
| retry_count | INT | DEFAULT 0 |
| max_retries | INT | DEFAULT 3 |
| last_error | TEXT |  |
| last_error_step | TEXT |  |
| recovered_from | UUID |  |
| tenant_id | UUID |  |
| actor_id | UUID |  |
| actor_email | TEXT |  |
| payload | JSONB | DEFAULT '{}'::jsonb |
| source | TEXT | NOT NULL, DEFAULT 'pipeline'::text |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |
| opportunity_id | UUID |  |
| scope | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | FOREIGN KEY (trigger_event_id) REFERENCES system_events(id) |
| | | CHECK (((scope IS NULL) OR (scope = ANY (ARRAY['opp'::text, 'spotlight'::text, 'project'::text, 'contract'::text])))) |
| | | CHECK ((source = ANY (ARRAY['pipeline'::text, 'cms'::text]))) |
| | | CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'paused'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'retrying'::text]))) |
| | | INDEX idx_process_instances_created (created_at DESC) |
| | | UNIQUE INDEX idx_process_instances_dedup (workflow_name, trigger_event_id) WHERE (trigger_event_id IS NOT NULL) |
| | | INDEX idx_process_instances_heartbeat (last_heartbeat_at) WHERE (status = 'running'::text) |
| | | INDEX idx_process_instances_opportunity (opportunity_id) WHERE (opportunity_id IS NOT NULL) |
| | | INDEX idx_process_instances_status (status) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text, 'paused'::text, 'retrying'::text])) |
| | | INDEX idx_process_instances_tenant (tenant_id) WHERE (tenant_id IS NOT NULL) |
| | | INDEX idx_process_instances_trigger (trigger_event_id) |
| | | INDEX idx_process_instances_workflow (workflow_name, status) |

### process_templates

| Column | Type | Constraints |
|--------|------|-------------|
| workflow_name | TEXT | NOT NULL |
| description | TEXT |  |
| trigger_key | TEXT |  |
| source | TEXT | NOT NULL, DEFAULT 'pipeline'::text |
| active | BOOLEAN | NOT NULL, DEFAULT true |
| active_date | TIMESTAMPTZ | DEFAULT now() |
| inactive_date | TIMESTAMPTZ |  |
| inactivated_by | TEXT |  |
| memo | TEXT |  |
| first_registered_at | TIMESTAMPTZ | DEFAULT now() |
| last_seen_at | TIMESTAMPTZ | DEFAULT now() |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |
| | | PRIMARY KEY (workflow_name) |
| | | CHECK ((source = ANY (ARRAY['pipeline'::text, 'cms'::text]))) |
| | | INDEX idx_process_templates_active (source, active) |

### promo_codes

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| code | TEXT | NOT NULL |
| kind | TEXT | NOT NULL, DEFAULT 'comp'::text |
| value | INT | NOT NULL, DEFAULT 0 |
| active | BOOLEAN | NOT NULL, DEFAULT true |
| max_uses | INT |  |
| used_count | INT | NOT NULL, DEFAULT 0 |
| expires_at | TIMESTAMPTZ |  |
| note | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (code) |
| | | CHECK ((kind = ANY (ARRAY['comp'::text, 'percent'::text, 'amount'::text]))) |
| | | UNIQUE INDEX idx_promo_codes_lower (lower(code)) |

### proposal_activity_log

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| tenant_id | UUID | NOT NULL |
| actor_id | UUID |  |
| actor_email | TEXT |  |
| actor_role | TEXT |  |
| activity_type | TEXT | NOT NULL |
| section_id | UUID |  |
| section_title | TEXT |  |
| details | JSONB | DEFAULT '{}'::jsonb |
| entity_version | INT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (actor_id) REFERENCES users(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | FOREIGN KEY (section_id) REFERENCES proposal_sections(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((activity_type = ANY (ARRAY['section_edited'::text, 'section_saved'::text, 'section_reverted'::text, 'section_assigned'::text, 'section_unassigned'::text, 'stage_advanced'::text, 'stage_reverted'::text, 'proposal_locked'::text, 'proposal_unlocked'::text, 'collaborator_invited'::text, 'collaborator_removed'::text, 'collaborator_access_changed'::text, 'comment_added'::text, 'comment_resolved'::text, 'ai_draft_requested'::text, 'ai_review_requested'::text, 'compliance_checked'::text, 'outcome_recorded'::text, 'document_uploaded'::text, 'document_deleted'::text, 'proposal_created'::text, 'proposal_exported'::text]))) |
| | | INDEX idx_pal_actor (actor_id, created_at DESC) |
| | | INDEX idx_pal_proposal (proposal_id, created_at DESC) |
| | | INDEX idx_pal_section (section_id) WHERE (section_id IS NOT NULL) |
| | | INDEX idx_pal_tenant (tenant_id, created_at DESC) |
| | | INDEX idx_pal_type (activity_type, created_at DESC) |

### proposal_artifacts

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| volume_id | UUID |  |
| volume_number | INT |  |
| volume_name | TEXT |  |
| artifact_type | TEXT | NOT NULL, DEFAULT 'narrative'::text |
| format_spec | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| compliance_spec | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| is_required | BOOLEAN | NOT NULL, DEFAULT true |
| status | TEXT | NOT NULL, DEFAULT 'draft'::text |
| is_locked | BOOLEAN | NOT NULL, DEFAULT false |
| locked_at | TIMESTAMPTZ |  |
| locked_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (locked_by) REFERENCES users(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | CHECK ((artifact_type = ANY (ARRAY['narrative'::text, 'cost'::text, 'form'::text, 'matrix'::text, 'other'::text]))) |
| | | CHECK ((status = ANY (ARRAY['draft'::text, 'in_progress'::text, 'locked'::text]))) |
| | | INDEX idx_proposal_artifacts_proposal (proposal_id, volume_number) |

### proposal_collaborators

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| user_id | UUID |  |
| email | TEXT | NOT NULL |
| name | TEXT |  |
| role | TEXT | NOT NULL, DEFAULT 'contributor'::text |
| invited_by | UUID |  |
| invited_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| accepted_at | TIMESTAMPTZ |  |
| assigned_sections | UUID[] | DEFAULT '{}'::uuid[] |
| dropbox_enabled | BOOLEAN | DEFAULT true |
| | | PRIMARY KEY (id) |
| | | UNIQUE (proposal_id, email) |
| | | FOREIGN KEY (invited_by) REFERENCES users(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | FOREIGN KEY (user_id) REFERENCES users(id) |
| | | INDEX idx_proposal_collaborators_proposal (proposal_id) |

### proposal_comments

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| section_id | UUID |  |
| user_id | UUID | NOT NULL |
| content | TEXT | NOT NULL |
| resolved | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| recommendation_type | TEXT | NOT NULL, DEFAULT 'human'::text |
| category | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | FOREIGN KEY (section_id) REFERENCES proposal_sections(id) |
| | | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE |
| | | CHECK ((recommendation_type = ANY (ARRAY['human'::text, 'ai_review'::text, 'ai_suggestion'::text]))) |
| | | INDEX idx_proposal_comments_proposal (proposal_id) |
| | | INDEX idx_proposal_comments_section_rec (section_id, recommendation_type) |

### proposal_compliance_matrix

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| requirement_text | TEXT | NOT NULL |
| requirement_source | TEXT |  |
| is_mandatory | BOOLEAN | NOT NULL, DEFAULT true |
| status | TEXT | NOT NULL, DEFAULT 'not_addressed'::text |
| section_id | UUID |  |
| notes | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | FOREIGN KEY (section_id) REFERENCES proposal_sections(id) |
| | | CHECK ((status = ANY (ARRAY['not_addressed'::text, 'partial'::text, 'satisfied'::text, 'not_applicable'::text]))) |
| | | INDEX idx_proposal_compliance_matrix_proposal (proposal_id) |
| | | INDEX idx_proposal_compliance_matrix_proposal_section (proposal_id, section_id) |

### proposal_portals

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| opportunity_id | UUID | NOT NULL |
| proposal_id | UUID |  |
| label | TEXT | NOT NULL, DEFAULT 'primary'::text |
| status | TEXT | NOT NULL, DEFAULT 'guardrails_pending'::text |
| guardrail_config | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| launched_at | TIMESTAMPTZ |  |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| current_stage_index | INT | NOT NULL, DEFAULT 0 |
| paid_at | TIMESTAMPTZ |  |
| curation_due_at | TIMESTAMPTZ |  |
| | | PRIMARY KEY (id) |
| | | UNIQUE (tenant_id, opportunity_id, label) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((status = ANY (ARRAY['guardrails_pending'::text, 'curation_pending'::text, 'launched'::text, 'executing'::text, 'closeout'::text, 'archived'::text, 'abandoned'::text]))) |
| | | INDEX idx_pp_proposal (proposal_id) WHERE (proposal_id IS NOT NULL) |
| | | INDEX idx_pp_tenant_opp (tenant_id, opportunity_id) |

### proposal_reviews

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| stage | TEXT | NOT NULL |
| reviewer_id | UUID |  |
| is_ai_review | BOOLEAN | NOT NULL, DEFAULT false |
| overall_score | INT |  |
| strengths | TEXT |  |
| weaknesses | TEXT |  |
| recommendations | TEXT |  |
| section_scores | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL |
| | | INDEX idx_proposal_reviews_proposal (proposal_id) |

### proposal_sections

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| section_number | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| content | TEXT |  |
| page_allocation | INT |  |
| status | TEXT | NOT NULL, DEFAULT 'empty'::text |
| assigned_to | UUID |  |
| requirement_ids | UUID[] | DEFAULT '{}'::uuid[] |
| ai_confidence | FLOAT8 |  |
| version | INT | NOT NULL, DEFAULT 1 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| last_modified_by | UUID |  |
| editing_by | UUID |  |
| editing_since | TIMESTAMPTZ |  |
| completed_stage | TEXT |  |
| completed_at | TIMESTAMPTZ |  |
| accepted_by | UUID |  |
| accepted_at | TIMESTAMPTZ |  |
| is_locked | BOOLEAN | NOT NULL, DEFAULT false |
| locked_at | TIMESTAMPTZ |  |
| locked_by | UUID |  |
| volume_name | TEXT |  |
| volume_number | INT |  |
| section_type | TEXT |  |
| tags | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| meta | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| artifact_id | UUID |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (accepted_by) REFERENCES users(id) |
| | | FOREIGN KEY (artifact_id) REFERENCES proposal_artifacts(id) ON DELETE SET NULL |
| | | FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL |
| | | FOREIGN KEY (editing_by) REFERENCES users(id) |
| | | FOREIGN KEY (last_modified_by) REFERENCES users(id) |
| | | FOREIGN KEY (locked_by) REFERENCES users(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | CHECK ((status = ANY (ARRAY['empty'::text, 'ai_drafted'::text, 'in_progress'::text, 'complete'::text, 'approved'::text]))) |
| | | INDEX idx_proposal_sections_artifact (artifact_id) WHERE (artifact_id IS NOT NULL) |
| | | INDEX idx_proposal_sections_lock (proposal_id, is_locked) |
| | | INDEX idx_proposal_sections_proposal (proposal_id) |
| | | INDEX idx_proposal_sections_section_type (section_type) |
| | | INDEX idx_proposal_sections_volume (proposal_id, volume_number, section_number) |

### proposal_stage_history

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| from_stage | TEXT |  |
| to_stage | TEXT | NOT NULL |
| changed_by | UUID |  |
| notes | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | INDEX idx_proposal_stage_history_proposal (proposal_id) |

### proposal_supporting_docs

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| tenant_id | UUID | NOT NULL |
| requirement_label | TEXT | NOT NULL |
| requirement_source | TEXT |  |
| category | TEXT | NOT NULL, DEFAULT 'supporting_document'::text |
| is_required | BOOLEAN | NOT NULL, DEFAULT true |
| storage_key | TEXT |  |
| original_filename | TEXT |  |
| file_size | INT |  |
| content_type | TEXT |  |
| status | TEXT | NOT NULL, DEFAULT 'missing'::text |
| uploaded_by | UUID |  |
| uploaded_at | TIMESTAMPTZ |  |
| reviewed_by | UUID |  |
| reviewed_at | TIMESTAMPTZ |  |
| notes | TEXT |  |
| library_unit_id | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (library_unit_id) REFERENCES library_units(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | FOREIGN KEY (reviewed_by) REFERENCES users(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | FOREIGN KEY (uploaded_by) REFERENCES users(id) |
| | | CHECK ((category = ANY (ARRAY['supporting_document'::text, 'proposal_input'::text, 'other'::text]))) |
| | | CHECK ((status = ANY (ARRAY['missing'::text, 'uploaded'::text, 'reviewed'::text, 'approved'::text, 'waived'::text]))) |
| | | INDEX idx_psd_proposal (proposal_id) |
| | | INDEX idx_psd_status (status) WHERE (status <> 'approved'::text) |
| | | INDEX idx_psd_tenant (tenant_id) |

### proposals

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| opportunity_id | UUID | NOT NULL |
| solicitation_id | UUID |  |
| title | TEXT | NOT NULL |
| stage | TEXT | NOT NULL, DEFAULT 'draft'::text |
| stripe_payment_id | TEXT |  |
| is_locked | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| gate_config | JSONB | DEFAULT '["draft", "final"]'::jsonb |
| lock_count | INT | NOT NULL, DEFAULT 0 |
| download_count | INT | NOT NULL, DEFAULT 0 |
| last_locked_at | TIMESTAMPTZ |  |
| last_unlocked_at | TIMESTAMPTZ |  |
| unlock_deadline | TIMESTAMPTZ |  |
| version | INT | NOT NULL, DEFAULT 1 |
| last_modified_by | UUID |  |
| origin_card | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| source_bucket | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (last_modified_by) REFERENCES users(id) |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((stage = ANY (ARRAY['draft'::text, 'review'::text, 'final'::text, 'submitted'::text, 'archived'::text]))) |
| | | INDEX idx_proposals_opportunity (opportunity_id) |
| | | INDEX idx_proposals_tenant (tenant_id) |
| | | INDEX idx_proposals_tenant_opportunity (tenant_id, opportunity_id) |

### purchases

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| opportunity_id | UUID |  |
| proposal_id | UUID |  |
| stripe_session_id | TEXT |  |
| stripe_payment_intent | TEXT |  |
| product_type | TEXT | NOT NULL |
| amount_cents | INT | NOT NULL |
| status | TEXT | NOT NULL, DEFAULT 'pending'::text |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| promo_code | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((product_type = ANY (ARRAY['finder_subscription'::text, 'proposal_phase1'::text, 'proposal_phase2'::text, 'expert_consulting'::text]))) |
| | | CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'refunded'::text]))) |

### rate_limit_state

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| source | TEXT | NOT NULL |
| daily_limit | INT | NOT NULL, DEFAULT 1000 |
| daily_used | INT | NOT NULL, DEFAULT 0 |
| hourly_limit | INT | NOT NULL, DEFAULT 100 |
| hourly_used | INT | NOT NULL, DEFAULT 0 |
| last_reset_daily | TIMESTAMPTZ | DEFAULT now() |
| last_reset_hourly | TIMESTAMPTZ | DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (source) |

### sbir_awards

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| company_name | TEXT | NOT NULL |
| award_title | TEXT |  |
| agency | TEXT |  |
| branch | TEXT |  |
| phase | TEXT |  |
| program | TEXT |  |
| agency_tracking_number | TEXT |  |
| contract | TEXT |  |
| proposal_award_date | DATE |  |
| contract_end_date | DATE |  |
| solicitation_number | TEXT |  |
| solicitation_year | TEXT |  |
| solicitation_close_date | DATE |  |
| proposal_receipt_date | DATE |  |
| date_of_notification | DATE |  |
| topic_code | TEXT |  |
| award_year | TEXT |  |
| award_amount | NUMERIC(15,2) |  |
| uei | TEXT |  |
| duns | TEXT |  |
| hubzone_owned | BOOLEAN | DEFAULT false |
| disadvantaged | BOOLEAN | DEFAULT false |
| woman_owned | BOOLEAN | DEFAULT false |
| number_employees | INT |  |
| company_website | TEXT |  |
| address1 | TEXT |  |
| address2 | TEXT |  |
| city | TEXT |  |
| state | TEXT |  |
| zip | TEXT |  |
| abstract | TEXT |  |
| contact_name | TEXT |  |
| contact_title | TEXT |  |
| contact_phone | TEXT |  |
| contact_email | TEXT |  |
| pi_name | TEXT |  |
| pi_title | TEXT |  |
| pi_phone | TEXT |  |
| pi_email | TEXT |  |
| ri_name | TEXT |  |
| ri_poc_name | TEXT |  |
| ri_poc_phone | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | INDEX idx_sbir_awards_agency (agency, program) |
| | | UNIQUE INDEX idx_sbir_awards_atn (agency_tracking_number) WHERE ((agency_tracking_number IS NOT NULL) AND (agency_tracking_number <> ''::text)) |
| | | INDEX idx_sbir_awards_company (to_tsvector('english'::regconfig, company_name)) |
| | | INDEX idx_sbir_awards_sol (solicitation_number) WHERE (solicitation_number IS NOT NULL) |
| | | INDEX idx_sbir_awards_topic (topic_code) WHERE (topic_code IS NOT NULL) |
| | | INDEX idx_sbir_awards_uei (uei) WHERE ((uei IS NOT NULL) AND (uei <> ''::text)) |
| | | INDEX idx_sbir_awards_year (award_year) |

### sbir_companies

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| company_name | TEXT | NOT NULL |
| uei | TEXT |  |
| duns | TEXT |  |
| address1 | TEXT |  |
| address2 | TEXT |  |
| city | TEXT |  |
| state | TEXT |  |
| zip | TEXT |  |
| country | TEXT |  |
| company_url | TEXT |  |
| hubzone_owned | BOOLEAN | DEFAULT false |
| woman_owned | BOOLEAN | DEFAULT false |
| disadvantaged | BOOLEAN | DEFAULT false |
| number_awards | INT | DEFAULT 0 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | INDEX idx_sbir_companies_name (to_tsvector('english'::regconfig, company_name)) |
| | | INDEX idx_sbir_companies_state (state) |
| | | UNIQUE INDEX idx_sbir_companies_uei (uei) WHERE ((uei IS NOT NULL) AND (uei <> ''::text)) |

### sbir_data_uploads

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| filename | TEXT | NOT NULL |
| file_hash | TEXT | NOT NULL |
| file_type | TEXT | NOT NULL |
| row_count | INT | NOT NULL, DEFAULT 0 |
| uploaded_by | UUID |  |
| storage_key | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (uploaded_by) REFERENCES users(id) |
| | | CHECK ((file_type = ANY (ARRAY['company'::text, 'award'::text]))) |
| | | UNIQUE INDEX idx_sbir_uploads_hash (file_hash) |

### section_standards

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| key | TEXT | NOT NULL |
| label | TEXT | NOT NULL |
| parent_key | TEXT |  |
| category | TEXT |  |
| program_types | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| description | TEXT |  |
| sort_order | INT | NOT NULL, DEFAULT 0 |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (key) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | FOREIGN KEY (parent_key) REFERENCES section_standards(key) ON DELETE CASCADE |
| | | INDEX idx_section_standards_category (category) |
| | | INDEX idx_section_standards_parent (parent_key) |

### semantic_memories

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| agent_role | TEXT | NOT NULL |
| embedding | VECTOR(1536) | NOT NULL |
| content | TEXT | NOT NULL |
| category | TEXT | NOT NULL |
| subcategory | TEXT |  |
| confidence | FLOAT8 | NOT NULL, DEFAULT 0.5 |
| evidence_count | INT | NOT NULL, DEFAULT 1 |
| relationships | JSONB | DEFAULT '[]'::jsonb |
| source_memories | UUID[] | DEFAULT '{}'::uuid[] |
| valid_from | TIMESTAMPTZ | DEFAULT now() |
| valid_until | TIMESTAMPTZ |  |
| version | INT | NOT NULL, DEFAULT 1 |
| previous_version | UUID |  |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| last_accessed | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| access_count | INT | NOT NULL, DEFAULT 0 |
| namespace | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (previous_version) REFERENCES semantic_memories(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | INDEX idx_semantic_namespace (namespace text_pattern_ops) WHERE (namespace IS NOT NULL) |
| | | INDEX idx_sm_active (is_active) WHERE is_active |
| | | INDEX idx_sm_embedding (embedding vector_cosine_ops) WITH (m='24', ef_construction='200') |
| | | INDEX idx_sm_tenant (tenant_id) |
| | | INDEX idx_sm_tenant_cat (tenant_id, category) |

### sessions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| session_token | TEXT | NOT NULL |
| user_id | UUID | NOT NULL |
| expires | TIMESTAMPTZ | NOT NULL |
| | | PRIMARY KEY (id) |
| | | UNIQUE (session_token) |
| | | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE |
| | | INDEX idx_sessions_user_id (user_id) |

### shadow_admin_grants

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| portal_id | UUID | NOT NULL |
| admin_user_id | UUID |  |
| admin_email | TEXT |  |
| source | TEXT | NOT NULL |
| active | BOOLEAN | NOT NULL, DEFAULT true |
| granted_by | UUID |  |
| granted_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| revoked_by | UUID |  |
| revoked_at | TIMESTAMPTZ |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (admin_user_id) REFERENCES users(id) |
| | | FOREIGN KEY (granted_by) REFERENCES users(id) |
| | | FOREIGN KEY (portal_id) REFERENCES proposal_portals(id) ON DELETE CASCADE |
| | | FOREIGN KEY (revoked_by) REFERENCES users(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((source = ANY (ARRAY['t_and_c'::text, 'invite'::text]))) |
| | | INDEX idx_sag_admin (admin_user_id) WHERE active |
| | | INDEX idx_sag_portal (portal_id) WHERE active |

### solicitation_annotations

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL |
| actor_id | UUID | NOT NULL |
| kind | TEXT | NOT NULL |
| source_location | JSONB | NOT NULL |
| payload | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| compliance_variable_name | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (actor_id) REFERENCES users(id) |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) ON DELETE CASCADE |
| | | CHECK ((kind = ANY (ARRAY['highlight'::text, 'text_box'::text, 'compliance_tag'::text]))) |
| | | INDEX idx_sol_annotations_sol (solicitation_id) |
| | | INDEX idx_sol_annotations_variable (compliance_variable_name) WHERE (compliance_variable_name IS NOT NULL) |

### solicitation_compliance

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL |
| page_limit_technical | INT |  |
| page_limit_cost | INT |  |
| page_limit_other | JSONB |  |
| font_family | TEXT |  |
| font_size | TEXT |  |
| margins | TEXT |  |
| line_spacing | TEXT |  |
| header_required | BOOLEAN | DEFAULT false |
| header_format | TEXT |  |
| footer_required | BOOLEAN | DEFAULT false |
| footer_format | TEXT |  |
| submission_format | TEXT |  |
| images_tables_allowed | BOOLEAN | DEFAULT true |
| slides_allowed | BOOLEAN | DEFAULT false |
| slide_limit | INT |  |
| slide_order | JSONB |  |
| required_sections | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| required_documents | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| evaluation_criteria | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| taba_allowed | BOOLEAN |  |
| indirect_rate_cap | NUMERIC |  |
| partner_max_pct | NUMERIC |  |
| cost_sharing_required | BOOLEAN | DEFAULT false |
| cost_volume_format | TEXT |  |
| pi_must_be_employee | BOOLEAN |  |
| pi_university_allowed | BOOLEAN |  |
| clearance_required | TEXT |  |
| itar_required | BOOLEAN | DEFAULT false |
| far_clauses | TEXT[] | DEFAULT '{}'::text[] |
| custom_variables | JSONB | DEFAULT '{}'::jsonb |
| verified_by | UUID |  |
| verified_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| topic_id | UUID |  |
| min_font_size | NUMERIC |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) |
| | | FOREIGN KEY (topic_id) REFERENCES opportunities(id) ON DELETE CASCADE |
| | | FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL |
| | | UNIQUE INDEX idx_compliance_sol_topic (solicitation_id, COALESCE(topic_id, '00000000-0000-0000-0000-000000000000'::uuid)) |
| | | INDEX idx_sol_compliance_sol_id (solicitation_id) |

### solicitation_documents

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL |
| document_type | TEXT | NOT NULL, DEFAULT 'source'::text |
| original_filename | TEXT | NOT NULL |
| storage_key | TEXT | NOT NULL |
| file_size | BIGINT |  |
| content_type | TEXT |  |
| page_count | INT |  |
| extracted_text | TEXT |  |
| extracted_at | TIMESTAMPTZ |  |
| uploaded_by | UUID |  |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| content_hash | TEXT |  |
| is_primary | BOOLEAN | NOT NULL, DEFAULT false |
| document_label | TEXT |  |
| | | PRIMARY KEY (id) |
| | | UNIQUE (storage_key) |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) ON DELETE CASCADE |
| | | FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL |
| | | CHECK ((document_type = ANY (ARRAY['source'::text, 'rfp'::text, 'nofo'::text, 'instructions'::text, 'amendment'::text, 'qa'::text, 'template'::text, 'supporting'::text, 'attachment'::text, 'topic'::text, 'other'::text]))) |
| | | UNIQUE INDEX idx_sol_docs_content_hash_unique (content_hash) WHERE (content_hash IS NOT NULL) |
| | | INDEX idx_sol_docs_needs_extraction (solicitation_id) WHERE (extracted_at IS NULL) |
| | | INDEX idx_sol_docs_solicitation (solicitation_id, created_at) |

### solicitation_outlines

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL |
| outline | JSONB | NOT NULL |
| notes | TEXT |  |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) |

### solicitation_templates

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| solicitation_id | UUID |  |
| namespace | TEXT |  |
| document_name | TEXT | NOT NULL |
| document_type | TEXT | NOT NULL |
| file_path | TEXT | NOT NULL |
| file_hash | TEXT |  |
| uploaded_by | UUID |  |
| notes | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) |
| | | FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL |

### solicitation_volumes

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL |
| volume_number | INT | NOT NULL |
| volume_name | TEXT | NOT NULL |
| volume_format | TEXT | DEFAULT 'custom'::text |
| description | TEXT |  |
| special_requirements | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| applies_to_phase | TEXT[] |  |
| topic_id | UUID |  |
| expert_notes | TEXT |  |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) ON DELETE CASCADE |
| | | FOREIGN KEY (topic_id) REFERENCES opportunities(id) ON DELETE CASCADE |
| | | CHECK ((volume_format = ANY (ARRAY['dsip_standard'::text, 'l_and_m'::text, 'custom'::text]))) |
| | | INDEX idx_sol_volumes_solicitation (solicitation_id, volume_number) |
| | | UNIQUE INDEX idx_volumes_sol_topic_num (solicitation_id, COALESCE(topic_id, '00000000-0000-0000-0000-000000000000'::uuid), volume_number) |

### source_diffs

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| profile_id | UUID | NOT NULL |
| region_id | UUID |  |
| prev_snapshot_id | UUID |  |
| next_snapshot_id | UUID |  |
| is_meaningful | BOOLEAN | DEFAULT false |
| summary | TEXT |  |
| extracted_opportunities | JSONB | DEFAULT '[]'::jsonb |
| severity | TEXT | DEFAULT 'info'::text |
| claude_model | TEXT |  |
| claude_tokens_used | INT |  |
| reviewed_by | UUID |  |
| reviewed_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (next_snapshot_id) REFERENCES source_snapshots(id) |
| | | FOREIGN KEY (prev_snapshot_id) REFERENCES source_snapshots(id) |
| | | FOREIGN KEY (profile_id) REFERENCES source_profiles(id) ON DELETE CASCADE |
| | | FOREIGN KEY (region_id) REFERENCES source_regions(id) |
| | | FOREIGN KEY (reviewed_by) REFERENCES users(id) |
| | | CHECK ((severity = ANY (ARRAY['info'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text]))) |
| | | INDEX idx_source_diffs_meaningful (is_meaningful, created_at DESC) WHERE (is_meaningful = true) |
| | | INDEX idx_source_diffs_profile (profile_id, created_at DESC) |

### source_health

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| source | TEXT | NOT NULL |
| status | TEXT | NOT NULL, DEFAULT 'unknown'::text |
| consecutive_failures | INT | NOT NULL, DEFAULT 0 |
| last_success_at | TIMESTAMPTZ |  |
| last_failure_at | TIMESTAMPTZ |  |
| avg_duration_ms | INT |  |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (source) |
| | | CHECK ((status = ANY (ARRAY['healthy'::text, 'degraded'::text, 'error'::text, 'unknown'::text]))) |

### source_profiles

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| site_type | TEXT | NOT NULL, DEFAULT 'custom'::text |
| base_url | TEXT | NOT NULL |
| bookmark_url | TEXT |  |
| agency | TEXT |  |
| program_type | TEXT |  |
| admin_notes | TEXT |  |
| visit_instructions | TEXT |  |
| topic_url_pattern | TEXT |  |
| pdf_url_pattern | TEXT |  |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| last_visited_at | TIMESTAMPTZ |  |
| last_visited_by | UUID |  |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| auto_crawl_enabled | BOOLEAN | DEFAULT false |
| crawl_cron | TEXT | DEFAULT '0 6 * * *'::text |
| last_crawl_at | TIMESTAMPTZ |  |
| crawl_config | JSONB | DEFAULT '{}'::jsonb |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | FOREIGN KEY (last_visited_by) REFERENCES users(id) |
| | | CHECK ((site_type = ANY (ARRAY['dsip'::text, 'sam_gov'::text, 'sbir_gov'::text, 'grants_gov'::text, 'afwerx'::text, 'xtech'::text, 'nsf'::text, 'custom'::text]))) |
| | | INDEX idx_source_profiles_active (site_type) WHERE (is_active = true) |
| | | UNIQUE INDEX idx_source_profiles_name (name) |

### source_regions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| profile_id | UUID | NOT NULL |
| name | TEXT | NOT NULL |
| selector_hint | TEXT |  |
| content_context | TEXT |  |
| region_type | TEXT | DEFAULT 'content'::text |
| sample_html | TEXT |  |
| sample_text | TEXT |  |
| is_active | BOOLEAN | DEFAULT true |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (profile_id) REFERENCES source_profiles(id) ON DELETE CASCADE |
| | | CHECK ((region_type = ANY (ARRAY['content'::text, 'listing'::text, 'download'::text, 'navigation'::text, 'table'::text]))) |
| | | INDEX idx_source_regions_profile (profile_id) WHERE (is_active = true) |

### source_snapshots

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| profile_id | UUID | NOT NULL |
| region_id | UUID |  |
| content_hash | TEXT | NOT NULL |
| content_text | TEXT |  |
| raw_html_s3_key | TEXT |  |
| captured_at | TIMESTAMPTZ | DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (profile_id) REFERENCES source_profiles(id) ON DELETE CASCADE |
| | | FOREIGN KEY (region_id) REFERENCES source_regions(id) ON DELETE SET NULL |
| | | INDEX idx_source_snapshots_region (region_id, captured_at DESC) |

### source_visits

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| profile_id | UUID | NOT NULL |
| visited_by | UUID |  |
| action | TEXT | NOT NULL |
| url | TEXT |  |
| notes | TEXT |  |
| files_count | INT | DEFAULT 0 |
| topics_count | INT | DEFAULT 0 |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (profile_id) REFERENCES source_profiles(id) ON DELETE CASCADE |
| | | FOREIGN KEY (visited_by) REFERENCES users(id) |
| | | CHECK ((action = ANY (ARRAY['visit'::text, 'download'::text, 'upload'::text, 'paste_topics'::text, 'import_topics'::text, 'shred'::text, 'note'::text]))) |
| | | INDEX idx_source_visits_profile (profile_id, created_at DESC) |

### spotlight_bucket_scores

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| opportunity_id | UUID | NOT NULL |
| bucket | TEXT | NOT NULL |
| score | INT | NOT NULL, DEFAULT 0 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (tenant_id, opportunity_id, bucket) |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE |
| | | CHECK ((bucket = ANY (ARRAY['technology_innovation'::text, 'service_offering'::text, 'capabilities'::text, 'readiness'::text, 'prior_funding'::text]))) |
| | | CHECK (((score >= 0) AND (score <= 100))) |
| | | INDEX idx_sbs_opp (opportunity_id) |
| | | INDEX idx_sbs_tenant_bucket_score (tenant_id, bucket, score DESC) |

### spotlights

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| name | TEXT | NOT NULL |
| description | TEXT |  |
| naics_codes | TEXT[] | DEFAULT '{}'::text[] |
| keywords | TEXT[] | DEFAULT '{}'::text[] |
| agencies | TEXT[] | DEFAULT '{}'::text[] |
| program_types | TEXT[] | DEFAULT '{}'::text[] |
| min_score | INT | DEFAULT 0 |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |

### stage_completion_snapshots

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| stage | TEXT | NOT NULL |
| completed_by | UUID |  |
| completed_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| sections_snapshot | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| total_sections | INT | NOT NULL, DEFAULT 0 |
| sections_complete | INT | NOT NULL, DEFAULT 0 |
| sections_approved | INT | NOT NULL, DEFAULT 0 |
| notes | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (completed_by) REFERENCES users(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | INDEX idx_scs_proposal (proposal_id, stage) |

### stage_gate_requirements

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL |
| stage | TEXT | NOT NULL |
| requirement_type | TEXT | NOT NULL |
| label | TEXT | NOT NULL |
| description | TEXT |  |
| is_met | BOOLEAN | NOT NULL, DEFAULT false |
| met_by | UUID |  |
| met_at | TIMESTAMPTZ |  |
| evidence | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (met_by) REFERENCES users(id) |
| | | FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE |
| | | CHECK ((requirement_type = ANY (ARRAY['all_sections_complete'::text, 'compliance_check_passed'::text, 'min_sections_approved'::text, 'admin_review_complete'::text, 'collaborator_signoff'::text, 'custom'::text]))) |
| | | INDEX idx_sgr_proposal_stage (proposal_id, stage) |

### system_config

| Column | Type | Constraints |
|--------|------|-------------|
| key | TEXT | NOT NULL |
| value | TEXT | NOT NULL |
| description | TEXT |  |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| deploy_environment | TEXT | DEFAULT 'production'::text |
| | | PRIMARY KEY (key) |

### system_events

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| namespace | TEXT | NOT NULL |
| type | TEXT | NOT NULL |
| phase | TEXT | NOT NULL |
| actor_type | TEXT | NOT NULL |
| actor_id | TEXT | NOT NULL |
| actor_email | TEXT |  |
| tenant_id | UUID |  |
| parent_event_id | UUID |  |
| payload | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| error | JSONB |  |
| duration_ms | INT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (parent_event_id) REFERENCES system_events(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text, 'pipeline'::text, 'agent'::text]))) |
| | | CHECK ((namespace = ANY (ARRAY['finder'::text, 'capture'::text, 'identity'::text, 'proposal'::text, 'library'::text, 'system'::text, 'tool'::text]))) NOT VALID |
| | | CHECK ((phase = ANY (ARRAY['start'::text, 'end'::text, 'single'::text]))) |
| | | INDEX idx_system_events_created_at (created_at DESC) |
| | | INDEX idx_system_events_errors (created_at DESC) WHERE (error IS NOT NULL) |
| | | INDEX idx_system_events_namespace_type (namespace, type) |
| | | INDEX idx_system_events_parent (parent_event_id) WHERE (parent_event_id IS NOT NULL) |
| | | INDEX idx_system_events_tenant_id (tenant_id) WHERE (tenant_id IS NOT NULL) |

### system_health_snapshots

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| captured_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| queue_depth | INT | NOT NULL, DEFAULT 0 |
| events_last_hour | INT | NOT NULL, DEFAULT 0 |
| errors_last_hour | INT | NOT NULL, DEFAULT 0 |
| db_reachable | BOOLEAN | NOT NULL, DEFAULT true |
| s3_reachable | BOOLEAN | NOT NULL, DEFAULT true |
| notes | JSONB | DEFAULT '{}'::jsonb |
| | | PRIMARY KEY (id) |
| | | INDEX idx_shs_captured (captured_at DESC) |

### tasks

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID |  |
| assignee_role | TEXT |  |
| assignee_user_id | UUID |  |
| task_type | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| description | TEXT |  |
| entity_type | TEXT |  |
| entity_id | UUID |  |
| process_instance_id | UUID |  |
| step_name | TEXT |  |
| status | TEXT | NOT NULL, DEFAULT 'open'::text |
| due_at | TIMESTAMPTZ |  |
| nudge_schedule | JSONB | DEFAULT '[]'::jsonb |
| nudges_sent | JSONB | DEFAULT '[]'::jsonb |
| params | JSONB | DEFAULT '{}'::jsonb |
| result | JSONB |  |
| completed_by | UUID |  |
| completed_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (process_instance_id) REFERENCES process_instances(id) ON DELETE CASCADE |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE |
| | | CHECK (((assignee_role IS NOT NULL) OR (assignee_user_id IS NOT NULL))) |
| | | CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'expired'::text]))) |
| | | INDEX idx_tasks_instance (process_instance_id) |
| | | INDEX idx_tasks_nudge_sweep (due_at) WHERE ((status = ANY (ARRAY['open'::text, 'in_progress'::text])) AND (due_at IS NOT NULL)) |
| | | INDEX idx_tasks_role_queue (assignee_role, tenant_id, due_at) WHERE (status = ANY (ARRAY['open'::text, 'in_progress'::text])) |
| | | INDEX idx_tasks_user_queue (assignee_user_id, due_at) WHERE (status = ANY (ARRAY['open'::text, 'in_progress'::text])) |

### taxonomy_terms

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| dimension | TEXT | NOT NULL |
| value | TEXT | NOT NULL |
| label | TEXT | NOT NULL |
| program_types | TEXT[] | NOT NULL, DEFAULT '{}'::text[] |
| sort_order | INT | NOT NULL, DEFAULT 0 |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (dimension, value) |
| | | INDEX idx_taxonomy_terms_dim (dimension, is_active) |

### tenant_actions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| opportunity_id | UUID | NOT NULL |
| user_id | UUID | NOT NULL |
| action_type | TEXT | NOT NULL |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | FOREIGN KEY (user_id) REFERENCES users(id) |
| | | CHECK ((action_type = ANY (ARRAY['thumbs_up'::text, 'thumbs_down'::text, 'pin'::text, 'unpin'::text, 'comment'::text, 'status_change'::text]))) |
| | | INDEX idx_tenant_actions_tenant (tenant_id) |

### tenant_agent_config

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| enabled_agents | TEXT[] | DEFAULT '{}'::text[] |
| monthly_budget | NUMERIC(10,2) | DEFAULT 50.00 |
| monthly_used | NUMERIC(10,2) | DEFAULT 0.00 |
| preferences | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| rate_limit_per_hour | INT |  |
| per_call_ceiling | NUMERIC(10,4) |  |
| | | PRIMARY KEY (id) |
| | | UNIQUE (tenant_id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |

### tenant_automation_preferences

| Column | Type | Constraints |
|--------|------|-------------|
| tenant_id | UUID | NOT NULL |
| notify_team_on_document_locked | BOOLEAN | NOT NULL, DEFAULT true |
| notify_collaborators_get_ready | BOOLEAN | NOT NULL, DEFAULT true |
| notify_on_stage_advanced | BOOLEAN | NOT NULL, DEFAULT true |
| notify_on_new_priority_opp | BOOLEAN | NOT NULL, DEFAULT true |
| ai_review_on_advance | BOOLEAN | NOT NULL, DEFAULT true |
| auto_advance_when_all_locked | BOOLEAN | NOT NULL, DEFAULT false |
| preferences | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| configured_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (tenant_id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE |

### tenant_bridge_cursor

| Column | Type | Constraints |
|--------|------|-------------|
| tenant_id | UUID | NOT NULL |
| last_posted_at | TIMESTAMPTZ | NOT NULL, DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone |
| last_event_id | UUID |  |
| last_applied_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (tenant_id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |

### tenant_bucket_scores

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| bucket_id | UUID | NOT NULL |
| opportunity_id | UUID | NOT NULL |
| score | INT | NOT NULL, DEFAULT 0 |
| factors | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| computed_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (tenant_id, bucket_id, opportunity_id) |
| | | FOREIGN KEY (bucket_id) REFERENCES tenant_spotlight_buckets(id) ON DELETE CASCADE |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | INDEX idx_tbs_tenant_bucket_score (tenant_id, bucket_id, score DESC) |

### tenant_opportunity_cards

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| opportunity_id | UUID | NOT NULL |
| card | JSONB | NOT NULL |
| bridge_version | INT | NOT NULL, DEFAULT 0 |
| lifecycle_status | TEXT | NOT NULL, DEFAULT 'open'::text |
| pursuit_status | TEXT | NOT NULL, DEFAULT 'unreviewed'::text |
| is_pinned | BOOLEAN | NOT NULL, DEFAULT false |
| pin_update_available | BOOLEAN | NOT NULL, DEFAULT false |
| pinned_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| pinned_docs | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| submission_stage | TEXT | NOT NULL, DEFAULT 'open'::text |
| | | PRIMARY KEY (id) |
| | | UNIQUE (tenant_id, opportunity_id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((lifecycle_status = ANY (ARRAY['open'::text, 'closed'::text, 'archived'::text]))) |
| | | CHECK ((pursuit_status = ANY (ARRAY['unreviewed'::text, 'pursuing'::text, 'monitoring'::text, 'passed'::text]))) |
| | | CHECK ((submission_stage = ANY (ARRAY['nofo'::text, 'pre_release'::text, 'open'::text, 'updated'::text, 'closed'::text, 'archived'::text]))) |
| | | INDEX idx_toc_opp (opportunity_id) |
| | | INDEX idx_toc_tenant (tenant_id) |
| | | INDEX idx_toc_tenant_pinned (tenant_id, is_pinned) WHERE is_pinned |

### tenant_pipeline_items

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| opportunity_id | UUID | NOT NULL |
| total_score | INT | NOT NULL, DEFAULT 0 |
| naics_score | INT | DEFAULT 0 |
| keyword_score | INT | DEFAULT 0 |
| agency_score | INT | DEFAULT 0 |
| set_aside_score | INT | DEFAULT 0 |
| type_score | INT | DEFAULT 0 |
| timeline_score | INT | DEFAULT 0 |
| llm_adjustment | INT | DEFAULT 0 |
| llm_rationale | TEXT |  |
| priority_tier | TEXT | DEFAULT  CASE WHEN (total_score >= 75) THEN 'high'::text WHEN (total_score >= 50) THEN 'medium'::text ELSE 'low'::text END |
| pursuit_status | TEXT | NOT NULL, DEFAULT 'unreviewed'::text |
| recommendation | TEXT |  |
| matched_keywords | TEXT[] | DEFAULT '{}'::text[] |
| is_pinned | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (tenant_id, opportunity_id) |
| | | FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK (((llm_adjustment >= '-15'::integer) AND (llm_adjustment <= 15))) |
| | | CHECK ((pursuit_status = ANY (ARRAY['unreviewed'::text, 'pursuing'::text, 'monitoring'::text, 'passed'::text]))) |
| | | INDEX idx_tenant_pipeline_items_opportunity (opportunity_id) |
| | | INDEX idx_tpi_tenant_pursuit (tenant_id, pursuit_status) |
| | | INDEX idx_tpi_tenant_score (tenant_id, total_score DESC) |

### tenant_profiles

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| naics_codes | TEXT[] | DEFAULT '{}'::text[] |
| keywords | TEXT[] | DEFAULT '{}'::text[] |
| agency_priorities | TEXT[] | DEFAULT '{}'::text[] |
| set_aside_types | TEXT[] | DEFAULT '{}'::text[] |
| technology_focus | TEXT |  |
| company_summary | TEXT |  |
| research_areas | TEXT[] | DEFAULT '{}'::text[] |
| target_agencies | TEXT[] | DEFAULT '{}'::text[] |
| min_surface_score | INT | DEFAULT 40 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (tenant_id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |

### tenant_spotlight_buckets

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| name | TEXT | NOT NULL |
| description | TEXT |  |
| criteria | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_by | UUID |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (created_by) REFERENCES users(id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | INDEX idx_tsb_tenant (tenant_id) WHERE is_active |

### tenant_uploads

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL |
| file_name | TEXT | NOT NULL |
| file_path | TEXT | NOT NULL |
| file_size | BIGINT |  |
| mime_type | TEXT |  |
| uploaded_by | UUID |  |
| processed | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | FOREIGN KEY (uploaded_by) REFERENCES users(id) |

### tenants

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| slug | TEXT | NOT NULL |
| name | TEXT | NOT NULL |
| legal_name | TEXT |  |
| website | TEXT |  |
| status | TEXT | NOT NULL, DEFAULT 'trial'::text |
| product_tier | TEXT | NOT NULL, DEFAULT 'finder'::text |
| billing_email | TEXT |  |
| trial_ends_at | TIMESTAMPTZ |  |
| storage_root | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| stripe_customer_id | TEXT |  |
| subscription_status | TEXT | NOT NULL, DEFAULT 'none'::text |
| lifecycle_stage | TEXT | DEFAULT 'customer'::text |
| | | PRIMARY KEY (id) |
| | | UNIQUE (slug) |
| | | CHECK ((lifecycle_stage = ANY (ARRAY['lead'::text, 'target'::text, 'customer'::text, 'at_risk'::text, 'churned'::text]))) |
| | | CHECK ((product_tier = ANY (ARRAY['finder'::text, 'reminder'::text, 'binder'::text, 'grinder'::text]))) |
| | | CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'churned'::text, 'trial'::text]))) |
| | | CHECK ((subscription_status = ANY (ARRAY['none'::text, 'active'::text, 'past_due'::text, 'canceled'::text]))) |

### tool_invocation_metrics

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| tool_name | TEXT | NOT NULL |
| tool_namespace | TEXT | NOT NULL |
| actor_type | TEXT | NOT NULL |
| actor_id | TEXT | NOT NULL |
| tenant_id | UUID |  |
| success | BOOLEAN | NOT NULL |
| error_code | TEXT |  |
| duration_ms | INT | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text, 'pipeline'::text, 'agent'::text]))) |
| | | INDEX idx_tim_errors (created_at DESC) WHERE (success = false) |
| | | INDEX idx_tim_tenant_created (tenant_id, created_at DESC) WHERE (tenant_id IS NOT NULL) |
| | | INDEX idx_tim_tool_created (tool_name, created_at DESC) |

### triage_actions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL |
| actor_id | UUID | NOT NULL |
| action | TEXT | NOT NULL |
| from_state | TEXT | NOT NULL |
| to_state | TEXT | NOT NULL |
| notes | TEXT |  |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | FOREIGN KEY (actor_id) REFERENCES users(id) |
| | | FOREIGN KEY (solicitation_id) REFERENCES curated_solicitations(id) ON DELETE CASCADE |
| | | CHECK ((action = ANY (ARRAY['claim'::text, 'release'::text, 'dismiss'::text, 'request_review'::text, 'approve'::text, 'reject'::text, 'push'::text, 'reclaim'::text, 'skip_shredder'::text, 'return_to_curation'::text]))) |
| | | INDEX idx_triage_actions_sol_chrono (solicitation_id, created_at DESC) |

### users

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| email | TEXT | NOT NULL |
| name | TEXT |  |
| role | TEXT | NOT NULL, DEFAULT 'tenant_user'::text |
| tenant_id | UUID |  |
| password_hash | TEXT |  |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| temp_password | BOOLEAN | NOT NULL, DEFAULT false |
| last_login_at | TIMESTAMPTZ |  |
| terms_accepted_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (email) |
| | | FOREIGN KEY (tenant_id) REFERENCES tenants(id) |
| | | CHECK ((role = ANY (ARRAY['master_admin'::text, 'rfp_admin'::text, 'tenant_admin'::text, 'tenant_user'::text, 'partner_user'::text]))) |
| | | INDEX idx_users_email (email) |
| | | INDEX idx_users_tenant (tenant_id) |

### verification_tokens

| Column | Type | Constraints |
|--------|------|-------------|
| identifier | TEXT | NOT NULL |
| token | TEXT | NOT NULL |
| expires | TIMESTAMPTZ | NOT NULL |
| | | PRIMARY KEY (identifier, token) |
| | | UNIQUE (token) |

### visitor_sessions

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| session_id | TEXT | NOT NULL |
| first_page | TEXT |  |
| referrer | TEXT |  |
| user_agent | TEXT |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| ip_hash | TEXT |  |
| device_type | TEXT |  |
| country | TEXT |  |
| last_seen_at | TIMESTAMPTZ | DEFAULT now() |
| page_count | INT | DEFAULT 0 |
| region | TEXT |  |
| city | TEXT |  |
| isp | TEXT |  |
| org | TEXT |  |
| asn | TEXT |  |
| timezone | TEXT |  |
| latitude | FLOAT8 |  |
| longitude | FLOAT8 |  |
| | | PRIMARY KEY (id) |
| | | UNIQUE (session_id) |
| | | INDEX idx_visitor_sessions_created_at (created_at) |

### volume_required_items

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| volume_id | UUID | NOT NULL |
| item_number | INT | NOT NULL |
| item_name | TEXT | NOT NULL |
| item_type | TEXT | NOT NULL, DEFAULT 'word_doc'::text |
| required | BOOLEAN | NOT NULL, DEFAULT true |
| page_limit | INT |  |
| slide_limit | INT |  |
| font_family | TEXT |  |
| font_size | TEXT |  |
| margins | TEXT |  |
| line_spacing | TEXT |  |
| header_format | TEXT |  |
| footer_format | TEXT |  |
| required_sections | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| format_rules | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| custom_fields | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| source_excerpts | JSONB | NOT NULL, DEFAULT '[]'::jsonb |
| metadata | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| verified_by | UUID |  |
| verified_at | TIMESTAMPTZ |  |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| applies_to_phase | TEXT[] |  |
| min_font_size | NUMERIC |  |
| canvas_preset | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| compliance_preset | JSONB | NOT NULL, DEFAULT '{}'::jsonb |
| template_id | UUID |  |
| expert_notes | TEXT |  |
| | | PRIMARY KEY (id) |
| | | UNIQUE (volume_id, item_number) |
| | | FOREIGN KEY (template_id) REFERENCES document_templates(id) |
| | | FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL |
| | | FOREIGN KEY (volume_id) REFERENCES solicitation_volumes(id) ON DELETE CASCADE |
| | | CHECK ((item_type = ANY (ARRAY['word_doc'::text, 'slide_deck'::text, 'spreadsheet'::text, 'pdf'::text, 'text'::text, 'form_sf424'::text, 'form_sbir_certs'::text, 'form_other'::text, 'other'::text]))) |
| | | INDEX idx_vol_items_volume (volume_id, item_number) |

### waitlist

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL, DEFAULT gen_random_uuid() |
| email | TEXT | NOT NULL |
| company_name | TEXT |  |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | PRIMARY KEY (id) |
| | | UNIQUE (email) |

## Views

- `solicitation_summary`
- `v_opportunity_rollup`
