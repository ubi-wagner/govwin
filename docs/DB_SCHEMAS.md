# DB_SCHEMAS.md — Complete Database Schema Reference

**Generated:** 2026-05-21
**Source:** All migrations in `db/migrations/` and `services/cms/db/`

> **⚠ PARTIAL / STALE — this table dump was generated around migration ~050 (2026-05-21); high-water is now `108`.**
> It is surgically maintained for the customer purchase + portal spine: `promo_codes`, `proposal_portals`,
> `shadow_admin_grants`, and the `curated_solicitations.spotlight_summary` / `purchases.promo_code` columns are
> current below. It does **NOT** yet include the many tables added by migrations 043+/086+ — the opportunity-card
> spine (`opportunity_bridge`, `tenant_opportunity_cards`, `tenant_spotlight_buckets`, `tenant_bucket_scores`),
> the unified library (`library_atoms`, `atom_tags`/`atom_members`/`atom_lineage`, `taxonomy_terms`,
> `document_cocoons`), plus `contracts`, `tasks`, `content_pages`, `process_instances`, `proposal_artifacts`, etc.
> For those, see `CLAUDE_CLIFFNOTES.md` §1b/§1c + its 2026-07-15 delta, and `docs/MASTER_MIRROR_OPP_DESIGN.md`.
> **This doc needs a full regeneration** (flagged in the maintenance changelog).

---

## Main Postgres Database (govtech_intel)

### accounts
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| user_id | UUID | NOT NULL, FK users(id) ON DELETE CASCADE |
| type | TEXT | NOT NULL |
| provider | TEXT | NOT NULL |
| provider_account_id | TEXT | NOT NULL |
| refresh_token | TEXT | |
| access_token | TEXT | |
| expires_at | BIGINT | |
| token_type | TEXT | |
| scope | TEXT | |
| id_token | TEXT | |
| | | UNIQUE(provider, provider_account_id) |

### agent_archetypes
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| role_name | TEXT | UNIQUE, NOT NULL |
| display_name | TEXT | NOT NULL |
| system_prompt | TEXT | NOT NULL |
| tools | TEXT[] | NOT NULL, DEFAULT '{}' |
| max_tokens | INT | NOT NULL, DEFAULT 4096 |
| temperature | FLOAT | NOT NULL, DEFAULT 0.3 |
| human_gate | BOOLEAN | NOT NULL, DEFAULT true |
| memory_categories | TEXT[] | DEFAULT '{}' |
| guardrails | JSONB | DEFAULT '{}' |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### agent_performance
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| agent_role | TEXT | NOT NULL |
| period_start | DATE | NOT NULL |
| period_end | DATE | NOT NULL |
| tasks_completed | INT | DEFAULT 0 |
| acceptance_rate | FLOAT | |
| avg_edit_pct | FLOAT | |
| avg_cost_usd | NUMERIC(10,6) | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | UNIQUE(tenant_id, agent_role, period_start) |

### agent_task_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| agent_role | TEXT | NOT NULL |
| task_type | TEXT | NOT NULL |
| trigger_event | TEXT | |
| proposal_id | UUID | FK proposals(id) |
| section_id | UUID | FK proposal_sections(id) |
| input_tokens | INT | |
| output_tokens | INT | |
| tool_calls_count | INT | DEFAULT 0 |
| duration_ms | INT | |
| cost_usd | NUMERIC(10,6) | |
| human_accepted | BOOLEAN | |
| human_edit_pct | FLOAT | |
| memories_retrieved | INT | DEFAULT 0 |
| memories_written | INT | DEFAULT 0 |
| error | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

RLS enabled.

### agent_task_queue
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| agent_role | TEXT | NOT NULL |
| task_type | TEXT | NOT NULL |
| input | JSONB | NOT NULL |
| proposal_id | UUID | FK proposals(id) |
| section_id | UUID | FK proposal_sections(id) |
| status | TEXT | NOT NULL, DEFAULT 'pending', CHECK IN ('pending','running','completed','failed') |
| worker_id | TEXT | |
| picked_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| error | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### agent_task_results
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| task_id | UUID | NOT NULL, FK agent_task_queue(id) |
| output | JSONB | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### api_key_registry
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| source | TEXT | UNIQUE, NOT NULL |
| encrypted_key | TEXT | |
| key_hint | TEXT | |
| expires_at | TIMESTAMPTZ | |
| last_validated | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### applications
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| contact_email | TEXT | NOT NULL |
| contact_name | TEXT | NOT NULL |
| contact_title | TEXT | |
| contact_phone | TEXT | |
| company_name | TEXT | NOT NULL |
| company_website | TEXT | |
| company_size | TEXT | |
| company_state | TEXT | |
| sam_registered | BOOLEAN | |
| sam_cage_code | TEXT | |
| duns_uei | TEXT | |
| previous_submissions | INTEGER | |
| previous_awards | INTEGER | |
| previous_award_programs | TEXT[] | |
| tech_summary | TEXT | NOT NULL |
| tech_areas | TEXT[] | NOT NULL, DEFAULT '{}' |
| target_programs | TEXT[] | NOT NULL, DEFAULT '{}' |
| target_agencies | TEXT[] | NOT NULL, DEFAULT '{}' |
| desired_outcomes | TEXT[] | NOT NULL, DEFAULT '{}' |
| motivation | TEXT | |
| referral_source | TEXT | |
| status | TEXT | NOT NULL, DEFAULT 'pending', CHECK IN ('pending','under_review','accepted','rejected','onboarded','withdrawn') |
| reviewed_by | UUID | FK users(id) |
| reviewed_at | TIMESTAMPTZ | |
| review_notes | TEXT | |
| accepted_cohort | TEXT | |
| terms_accepted_at | TIMESTAMPTZ | NOT NULL |
| terms_version | TEXT | NOT NULL, DEFAULT 'v1' |
| metadata | JSONB | NOT NULL, DEFAULT '{}' |
| ip_hash | TEXT | |
| user_agent | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### audit_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | FK tenants(id) |
| user_id | UUID | FK users(id) |
| action | TEXT | NOT NULL |
| entity_type | TEXT | |
| entity_id | TEXT | |
| metadata | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### automation_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| rule_id | UUID | FK automation_rules(id) |
| trigger_event_id | UUID | |
| action_taken | TEXT | |
| action_type | TEXT | NOT NULL, DEFAULT '' |
| status | TEXT | NOT NULL, DEFAULT 'success', CHECK IN ('success','failed','skipped') |
| result | JSONB | DEFAULT '{}' |
| error_message | TEXT | |
| executed_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### automation_rules
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | TEXT | UNIQUE (via index), NOT NULL |
| description | TEXT | |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| trigger_bus | TEXT | DEFAULT '' (legacy, nullable) |
| trigger_events | TEXT[] | DEFAULT '{}' (legacy, nullable) |
| conditions | JSONB | DEFAULT '{}' |
| trigger_namespace | TEXT | NOT NULL, DEFAULT '' |
| trigger_type | TEXT | NOT NULL, DEFAULT '' |
| action_type | TEXT | NOT NULL, CHECK IN ('log_only','queue_notification','queue_job','emit_event','send_email','notify_admin','webhook','update_status','create_todo','distribute_social','publish_content','enroll_drip') |
| action_config | JSONB | DEFAULT '{}' |
| cooldown_minutes | INT | DEFAULT 0 |
| max_fires_per_hour | INT | DEFAULT 100 |
| enabled | BOOLEAN | NOT NULL, DEFAULT true |
| created_by | UUID | FK users(id) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### canvas_versions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| section_id | UUID | NOT NULL, FK proposal_sections(id) ON DELETE CASCADE |
| version_number | INTEGER | NOT NULL |
| content | JSONB | NOT NULL |
| snapshot_reason | TEXT | |
| created_by | UUID | FK users(id) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | UNIQUE(section_id, version_number) |

### cms_content
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| slug | TEXT | NOT NULL, UNIQUE |
| title | TEXT | NOT NULL |
| content_type | TEXT | NOT NULL, DEFAULT 'page_block', CHECK IN ('blog_post','resource','guide','announcement','faq','testimonial','team_member','social_post','page_block') |
| body | TEXT | NOT NULL, DEFAULT '' |
| excerpt | TEXT | |
| author | TEXT | |
| tags | TEXT[] | DEFAULT '{}' |
| published | BOOLEAN | NOT NULL, DEFAULT false |
| published_at | TIMESTAMPTZ | |
| featured_image | TEXT | |
| metadata | JSONB | NOT NULL, DEFAULT '{}' |
| created_by | UUID | FK users(id) |
| external_url | TEXT | |
| display_order | INT | DEFAULT 0 |
| status | TEXT | NOT NULL, DEFAULT 'draft', CHECK IN ('draft','pending','published','private','archived') |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### collaborator_stage_access
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| collaborator_id | UUID | NOT NULL, FK proposal_collaborators(id) |
| proposal_id | UUID | NOT NULL, FK proposals(id) ON DELETE CASCADE |
| stage | TEXT | NOT NULL |
| artifact_types | TEXT[] | DEFAULT '{}' |
| permission | TEXT | NOT NULL, DEFAULT 'view', CHECK IN ('view','comment','edit') |
| access_granted_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| access_revoked_at | TIMESTAMPTZ | |
| granted_by | UUID | FK users(id) |

### compliance_presets
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| phase_type | TEXT | NOT NULL |
| agency | TEXT | |
| program_type | TEXT | |
| compliance_data | JSONB | NOT NULL, DEFAULT '{}' |
| volumes_data | JSONB | NOT NULL, DEFAULT '[]' |
| is_system | BOOLEAN | DEFAULT false |
| created_by | UUID | FK users(id) |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| | | UNIQUE(name, phase_type) via index |

### compliance_variables
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | TEXT | UNIQUE, NOT NULL |
| label | TEXT | NOT NULL |
| category | TEXT | NOT NULL |
| data_type | TEXT | NOT NULL, DEFAULT 'text', CHECK IN ('text','number','boolean','select','multiselect') |
| options | JSONB | |
| is_system | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### consent_records
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| user_id | UUID | NOT NULL, FK users(id) |
| document_type | TEXT | NOT NULL |
| document_version | TEXT | NOT NULL |
| accepted_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| ip_address | TEXT | |

### content_events
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| event_type | TEXT | NOT NULL |
| metadata | JSONB | DEFAULT '{}' |
| processed | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### curated_solicitations
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| opportunity_id | UUID | NOT NULL, FK opportunities(id) |
| namespace | TEXT | NOT NULL |
| status | TEXT | NOT NULL, DEFAULT 'new', CHECK IN ('new','claimed','released','released_for_analysis','ai_analyzed','shredder_failed','curation_in_progress','review_requested','approved','pushed_to_pipeline','dismissed','rejected_review') |
| claimed_by | UUID | FK users(id) ON DELETE SET NULL |
| claimed_at | TIMESTAMPTZ | |
| curated_by | UUID | FK users(id) ON DELETE SET NULL |
| approved_by | UUID | FK users(id) ON DELETE SET NULL |
| pushed_at | TIMESTAMPTZ | |
| dismissed_reason | TEXT | |
| phase_like | TEXT | CHECK IN ('phase_1','phase_2') |
| ai_extracted | JSONB | |
| ai_confidence | FLOAT | |
| ai_similar_to | UUID | FK curated_solicitations(id) |
| ai_similarity_score | FLOAT | |
| full_text | TEXT | |
| full_text_tsv | TSVECTOR | GENERATED ALWAYS AS (to_tsvector('english', COALESCE(full_text, ''))) STORED |
| annotations | JSONB | DEFAULT '[]' |
| review_requested_for | UUID | FK users(id) |
| solicitation_type | TEXT | DEFAULT 'single', CHECK IN ('single','multi_topic') |
| solicitation_title | TEXT | |
| solicitation_number | TEXT | |
| round_number | INTEGER | |
| round_label | TEXT | |
| spotlight_summary | TEXT | (mig 107 — admin first-pass matching blurb; required before push, folded into the fan-out card) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### customer_events
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| event_type | TEXT | NOT NULL |
| tenant_id | UUID | FK tenants(id) |
| user_id | UUID | FK users(id) |
| metadata | JSONB | DEFAULT '{}' |
| processed | BOOLEAN | NOT NULL, DEFAULT false |
| processed_by | TEXT | |
| processed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### document_templates
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| description | TEXT | |
| template_type | TEXT | NOT NULL, CHECK IN ('technical_volume','cost_volume','slide_deck','past_performance','key_personnel','commercialization','abstract','cover_sheet','supporting_docs','custom') |
| agency | TEXT | |
| program_type | TEXT | |
| storage_key | TEXT | NOT NULL |
| canvas_preset | JSONB | NOT NULL |
| node_count | INTEGER | DEFAULT 0 |
| is_system | BOOLEAN | NOT NULL, DEFAULT false |
| tenant_id | UUID | FK tenants(id) |
| created_by | UUID | FK users(id) |
| metadata | JSONB | NOT NULL, DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### episodic_memories
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| agent_role | TEXT | NOT NULL |
| embedding | vector(1536) | NOT NULL |
| content | TEXT | NOT NULL |
| memory_type | TEXT | NOT NULL, DEFAULT 'observation', CHECK IN ('observation','interaction','decision','outcome') |
| importance | FLOAT | NOT NULL, DEFAULT 0.5 |
| entities | JSONB | DEFAULT '[]' |
| metadata | JSONB | DEFAULT '{}' |
| source | TEXT | |
| occurred_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| last_accessed | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| access_count | INT | NOT NULL, DEFAULT 0 |
| decay_factor | FLOAT | NOT NULL, DEFAULT 1.0 |
| is_archived | BOOLEAN | NOT NULL, DEFAULT false |
| superseded_by | UUID | FK episodic_memories(id) |
| namespace | TEXT | |

RLS enabled.

### invitations
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| email | TEXT | NOT NULL |
| role | TEXT | NOT NULL, DEFAULT 'tenant_user' |
| token | TEXT | UNIQUE, NOT NULL |
| invited_by | UUID | FK users(id) |
| accepted_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### legal_document_versions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| document_type | TEXT | NOT NULL |
| version | TEXT | NOT NULL |
| content_hash | TEXT | |
| effective_date | DATE | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | UNIQUE(document_type, version) |

### library_atom_outcomes
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| unit_id | UUID | NOT NULL, FK library_units(id) |
| proposal_id | UUID | NOT NULL, FK proposals(id) |
| outcome | TEXT | CHECK IN ('win','loss','pending') |
| recorded_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### library_harvest_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| proposal_id | UUID | FK proposals(id) |
| unit_id | UUID | FK library_units(id) |
| harvested_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### library_units
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| content | TEXT | NOT NULL |
| category | TEXT | NOT NULL |
| subcategory | TEXT | |
| tags | TEXT[] | DEFAULT '{}' |
| embedding | vector(1536) | |
| confidence | FLOAT | NOT NULL, DEFAULT 0.5 |
| status | TEXT | NOT NULL, DEFAULT 'draft', CHECK IN ('draft','approved','archived') |
| source_type | TEXT | DEFAULT 'manual', CHECK IN ('manual','upload','harvest','ai') |
| source_id | TEXT | |
| usage_count | INT | NOT NULL, DEFAULT 0 |
| parent_unit_id | UUID | FK library_units(id) |
| outcome | TEXT | CHECK IN ('pending','awarded','rejected','withdrawn') |
| outcome_score | REAL | DEFAULT 0.5 |
| original_proposal_id | UUID | |
| original_node_id | TEXT | |
| atom_hash | TEXT | |
| canvas_nodes | JSONB | |
| document_metadata | JSONB | DEFAULT '{}' |
| source_filename | TEXT | |
| source_storage_key | TEXT | |
| heading_text | TEXT | |
| char_offset | INT | |
| char_length | INT | |
| is_seminal | BOOLEAN | DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### opportunities
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| source | TEXT | NOT NULL |
| source_id | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| agency | TEXT | |
| office | TEXT | |
| solicitation_number | TEXT | |
| naics_codes | TEXT[] | DEFAULT '{}' |
| classification_code | TEXT | |
| set_aside_type | TEXT | |
| program_type | TEXT | |
| close_date | TIMESTAMPTZ | |
| posted_date | TIMESTAMPTZ | |
| estimated_value_min | NUMERIC | |
| estimated_value_max | NUMERIC | |
| description | TEXT | |
| content_hash | TEXT | UNIQUE |
| full_text_tsv | TSVECTOR | |
| award_date | TIMESTAMPTZ | |
| award_amount | NUMERIC | |
| awardee | TEXT | |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| solicitation_id | UUID | FK curated_solicitations(id) ON DELETE SET NULL |
| topic_number | TEXT | |
| topic_branch | TEXT | |
| topic_status | TEXT | DEFAULT 'open', CHECK IN ('open','pre_release','closed','awarded','withdrawn') |
| tech_focus_areas | TEXT[] | NOT NULL, DEFAULT '{}' |
| poc_name | TEXT | |
| poc_email | TEXT | |
| topic_metadata | JSONB | NOT NULL, DEFAULT '{}' |
| phase_type | TEXT | CHECK IN ('phase_1','phase_2','direct_to_phase_2','phase_3','cso','ota','baa','other') |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | UNIQUE(source, source_id) |

### opportunity_events
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| event_type | TEXT | NOT NULL |
| opportunity_id | UUID | FK opportunities(id) |
| source | TEXT | |
| metadata | JSONB | DEFAULT '{}' |
| processed | BOOLEAN | NOT NULL, DEFAULT false |
| processed_by | TEXT | |
| processed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### page_views
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| session_id | TEXT | NOT NULL |
| page_path | TEXT | NOT NULL |
| duration_ms | INTEGER | |
| referrer | TEXT | |
| utm_source | TEXT | |
| utm_medium | TEXT | |
| utm_campaign | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### pipeline_jobs
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| source | TEXT | NOT NULL |
| run_type | TEXT | NOT NULL, DEFAULT 'full' |
| status | TEXT | NOT NULL, DEFAULT 'pending', CHECK IN ('pending','running','completed','failed') |
| worker_id | TEXT | |
| result | JSONB | |
| error | TEXT | |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| priority | INTEGER | NOT NULL, DEFAULT 5 |
| metadata | JSONB | NOT NULL, DEFAULT '{}' |
| kind | TEXT | NOT NULL, DEFAULT 'ingest', CHECK IN ('ingest','shred_solicitation','scout_source','draft_section','review_section') |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### pipeline_runs
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| job_id | UUID | FK pipeline_jobs(id) |
| source | TEXT | NOT NULL |
| run_type | TEXT | NOT NULL |
| metrics | JSONB | DEFAULT '{}' |
| started_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| completed_at | TIMESTAMPTZ | |

### pipeline_schedules
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| source | TEXT | NOT NULL, UNIQUE |
| run_type | TEXT | NOT NULL, DEFAULT 'full' |
| cron_expression | TEXT | NOT NULL |
| enabled | BOOLEAN | NOT NULL, DEFAULT true |
| next_run_at | TIMESTAMPTZ | |
| last_run_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### procedural_memories
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| agent_role | TEXT | NOT NULL |
| embedding | vector(1536) | NOT NULL |
| name | TEXT | NOT NULL |
| description | TEXT | NOT NULL |
| steps | JSONB | NOT NULL, DEFAULT '[]' |
| trigger_conditions | JSONB | DEFAULT '{}' |
| success_rate | FLOAT | DEFAULT 0.5 |
| execution_count | INT | NOT NULL, DEFAULT 0 |
| last_executed | TIMESTAMPTZ | |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| namespace | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

RLS enabled.

### promo_codes
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| code | TEXT | NOT NULL, UNIQUE (+ UNIQUE INDEX on lower(code) for case-insensitive lookup) |
| kind | TEXT | NOT NULL, DEFAULT 'comp', CHECK IN ('comp','percent','amount') |
| value | INTEGER | NOT NULL, DEFAULT 0 (percent 0-100 or amount_cents; ignored when kind='comp') |
| active | BOOLEAN | NOT NULL, DEFAULT true |
| max_uses | INTEGER | (NULL = unlimited) |
| used_count | INTEGER | NOT NULL, DEFAULT 0 |
| expires_at | TIMESTAMPTZ | |
| note | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

Added in migration 105. Seeded with comp code `rfppipelinetest` (kind=comp → 100% off, bypasses Stripe, marks the purchase paid).

### proposal_collaborators
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL, FK proposals(id) ON DELETE CASCADE |
| user_id | UUID | FK users(id) |
| email | TEXT | NOT NULL |
| name | TEXT | |
| role | TEXT | NOT NULL, DEFAULT 'contributor' |
| invited_by | UUID | FK users(id) |
| invited_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| accepted_at | TIMESTAMPTZ | |
| assigned_sections | UUID[] | DEFAULT '{}' |
| dropbox_enabled | BOOLEAN | DEFAULT true |
| | | UNIQUE(proposal_id, email) |

### proposal_comments
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL, FK proposals(id) ON DELETE CASCADE |
| section_id | UUID | FK proposal_sections(id) |
| user_id | UUID | NOT NULL, FK users(id) ON DELETE CASCADE |
| content | TEXT | NOT NULL |
| resolved | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### proposal_compliance_matrix
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL, FK proposals(id) ON DELETE CASCADE |
| requirement_text | TEXT | NOT NULL |
| requirement_source | TEXT | |
| is_mandatory | BOOLEAN | NOT NULL, DEFAULT true |
| status | TEXT | NOT NULL, DEFAULT 'not_addressed', CHECK IN ('not_addressed','partial','satisfied','not_applicable') |
| section_id | UUID | FK proposal_sections(id) |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### proposal_portals
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| opportunity_id | UUID | NOT NULL (card link — SOFT ref, shard-safe; no FK) |
| proposal_id | UUID | FK proposals(id) |
| label | TEXT | NOT NULL, DEFAULT 'primary' (disambiguates multi-proposal per opp) |
| status | TEXT | NOT NULL, DEFAULT 'guardrails_pending', CHECK IN ('guardrails_pending','curation_pending','launched','executing','closeout','archived','abandoned') |
| guardrail_config | JSONB | NOT NULL, DEFAULT '{}' (frozen at accept-launch) |
| current_stage_index | INT | NOT NULL, DEFAULT 0 (mig 098) |
| paid_at | TIMESTAMPTZ | (mig 105) |
| curation_due_at | TIMESTAMPTZ | (mig 105 — 72h curation SLA timer) |
| launched_at | TIMESTAMPTZ | |
| created_by | UUID | FK users(id) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | UNIQUE(tenant_id, opportunity_id, label) |

Added in migration 097 (`curation_pending` status + `paid_at`/`curation_due_at` added in 105; `current_stage_index` in 098). RLS ENABLE + FORCE (`tenant_isolation` policy on the `app.tenant_id` GUC).

### proposal_reviews
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL, FK proposals(id) ON DELETE CASCADE |
| stage | TEXT | NOT NULL |
| reviewer_id | UUID | FK users(id) ON DELETE SET NULL |
| is_ai_review | BOOLEAN | NOT NULL, DEFAULT false |
| overall_score | INT | |
| strengths | TEXT | |
| weaknesses | TEXT | |
| recommendations | TEXT | |
| section_scores | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### proposal_sections
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL, FK proposals(id) ON DELETE CASCADE |
| section_number | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| content | TEXT | |
| page_allocation | INT | |
| status | TEXT | NOT NULL, DEFAULT 'empty', CHECK IN ('empty','ai_drafted','in_progress','complete','approved') |
| assigned_to | UUID | FK users(id) ON DELETE SET NULL |
| requirement_ids | UUID[] | DEFAULT '{}' |
| ai_confidence | FLOAT | |
| version | INT | NOT NULL, DEFAULT 1 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### proposal_stage_history
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| proposal_id | UUID | NOT NULL, FK proposals(id) ON DELETE CASCADE |
| from_stage | TEXT | |
| to_stage | TEXT | NOT NULL |
| changed_by | UUID | FK users(id) ON DELETE SET NULL |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### proposals
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| opportunity_id | UUID | NOT NULL, FK opportunities(id) |
| solicitation_id | UUID | FK curated_solicitations(id) |
| title | TEXT | NOT NULL |
| stage | TEXT | NOT NULL, DEFAULT 'draft', CHECK IN ('draft','review','final','submitted','archived') |
| stripe_payment_id | TEXT | |
| is_locked | BOOLEAN | NOT NULL, DEFAULT false |
| gate_config | JSONB | DEFAULT '["draft","final"]' |
| lock_count | INT | NOT NULL, DEFAULT 0 |
| download_count | INT | NOT NULL, DEFAULT 0 |
| last_locked_at | TIMESTAMPTZ | |
| last_unlocked_at | TIMESTAMPTZ | |
| unlock_deadline | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### purchases
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| opportunity_id | UUID | FK opportunities(id) |
| proposal_id | UUID | FK proposals(id) |
| stripe_session_id | TEXT | |
| stripe_payment_intent | TEXT | |
| product_type | TEXT | NOT NULL, CHECK IN ('finder_subscription','proposal_phase1','proposal_phase2','expert_consulting') |
| amount_cents | INT | NOT NULL |
| status | TEXT | NOT NULL, DEFAULT 'pending', CHECK IN ('pending','completed','failed','refunded') |
| metadata | JSONB | DEFAULT '{}' |
| promo_code | TEXT | (mig 105 — provenance for a comp/discount purchase; FK-free ref to promo_codes.code) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### rate_limit_state
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| source | TEXT | UNIQUE, NOT NULL |
| daily_limit | INT | NOT NULL, DEFAULT 1000 |
| daily_used | INT | NOT NULL, DEFAULT 0 |
| hourly_limit | INT | NOT NULL, DEFAULT 100 |
| hourly_used | INT | NOT NULL, DEFAULT 0 |
| last_reset_daily | TIMESTAMPTZ | DEFAULT now() |
| last_reset_hourly | TIMESTAMPTZ | DEFAULT now() |

### sbir_awards
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| company_name | TEXT | NOT NULL |
| award_title | TEXT | |
| agency | TEXT | |
| branch | TEXT | |
| phase | TEXT | |
| program | TEXT | |
| agency_tracking_number | TEXT | |
| contract | TEXT | |
| proposal_award_date | DATE | |
| contract_end_date | DATE | |
| solicitation_number | TEXT | |
| solicitation_year | TEXT | |
| solicitation_close_date | DATE | |
| proposal_receipt_date | DATE | |
| date_of_notification | DATE | |
| topic_code | TEXT | |
| award_year | TEXT | |
| award_amount | NUMERIC(15,2) | |
| uei | TEXT | |
| duns | TEXT | |
| hubzone_owned | BOOLEAN | DEFAULT false |
| disadvantaged | BOOLEAN | DEFAULT false |
| woman_owned | BOOLEAN | DEFAULT false |
| number_employees | INTEGER | |
| company_website | TEXT | |
| address1 | TEXT | |
| address2 | TEXT | |
| city | TEXT | |
| state | TEXT | |
| zip | TEXT | |
| abstract | TEXT | |
| contact_name | TEXT | |
| contact_title | TEXT | |
| contact_phone | TEXT | |
| contact_email | TEXT | |
| pi_name | TEXT | |
| pi_title | TEXT | |
| pi_phone | TEXT | |
| pi_email | TEXT | |
| ri_name | TEXT | |
| ri_poc_name | TEXT | |
| ri_poc_phone | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### sbir_companies
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| company_name | TEXT | NOT NULL |
| uei | TEXT | |
| duns | TEXT | |
| address1 | TEXT | |
| address2 | TEXT | |
| city | TEXT | |
| state | TEXT | |
| zip | TEXT | |
| country | TEXT | |
| company_url | TEXT | |
| hubzone_owned | BOOLEAN | DEFAULT false |
| woman_owned | BOOLEAN | DEFAULT false |
| disadvantaged | BOOLEAN | DEFAULT false |
| number_awards | INTEGER | DEFAULT 0 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### sbir_data_uploads
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| filename | TEXT | NOT NULL |
| file_hash | TEXT | NOT NULL, UNIQUE (via index) |
| file_type | TEXT | NOT NULL, CHECK IN ('company','award') |
| row_count | INTEGER | NOT NULL, DEFAULT 0 |
| uploaded_by | UUID | FK users(id) |
| storage_key | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### semantic_memories
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| agent_role | TEXT | NOT NULL |
| embedding | vector(1536) | NOT NULL |
| content | TEXT | NOT NULL |
| category | TEXT | NOT NULL |
| subcategory | TEXT | |
| confidence | FLOAT | NOT NULL, DEFAULT 0.5 |
| evidence_count | INT | NOT NULL, DEFAULT 1 |
| relationships | JSONB | DEFAULT '[]' |
| source_memories | UUID[] | DEFAULT '{}' |
| valid_from | TIMESTAMPTZ | DEFAULT now() |
| valid_until | TIMESTAMPTZ | |
| version | INT | NOT NULL, DEFAULT 1 |
| previous_version | UUID | FK semantic_memories(id) |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| namespace | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| last_accessed | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| access_count | INT | NOT NULL, DEFAULT 0 |

RLS enabled.

### sessions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| session_token | TEXT | UNIQUE, NOT NULL |
| user_id | UUID | NOT NULL, FK users(id) ON DELETE CASCADE |
| expires | TIMESTAMPTZ | NOT NULL |

### shadow_admin_grants
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| portal_id | UUID | NOT NULL, FK proposal_portals(id) ON DELETE CASCADE |
| admin_user_id | UUID | FK users(id) (NULL = role-based grant) |
| admin_email | TEXT | |
| source | TEXT | NOT NULL, CHECK IN ('t_and_c','invite') |
| active | BOOLEAN | NOT NULL, DEFAULT true |
| granted_by | UUID | FK users(id) |
| granted_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| revoked_by | UUID | FK users(id) |
| revoked_at | TIMESTAMPTZ | |

Added in migration 097 — portal-scoped, T&C-at-purchase, customer-revocable admin access; the scoped replacement for `verifyTenantAccess`'s admin god-view (⚠ not yet enforced — the god-view still stands; see `CLAUDE_CLIFFNOTES.md` 2026-07-15 delta). RLS ENABLE + FORCE.

### solicitation_annotations
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL, FK curated_solicitations(id) ON DELETE CASCADE |
| actor_id | UUID | NOT NULL, FK users(id) |
| kind | TEXT | NOT NULL, CHECK IN ('highlight','text_box','compliance_tag') |
| source_location | JSONB | NOT NULL |
| payload | JSONB | NOT NULL, DEFAULT '{}' |
| compliance_variable_name | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### solicitation_compliance
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL, FK curated_solicitations(id) |
| page_limit_technical | INT | |
| page_limit_cost | INT | |
| page_limit_other | JSONB | |
| font_family | TEXT | |
| font_size | TEXT | |
| margins | TEXT | |
| line_spacing | TEXT | |
| header_required | BOOLEAN | DEFAULT false |
| header_format | TEXT | |
| footer_required | BOOLEAN | DEFAULT false |
| footer_format | TEXT | |
| submission_format | TEXT | |
| images_tables_allowed | BOOLEAN | DEFAULT true |
| slides_allowed | BOOLEAN | DEFAULT false |
| slide_limit | INT | |
| slide_order | JSONB | |
| required_sections | JSONB | NOT NULL, DEFAULT '[]' |
| required_documents | JSONB | NOT NULL, DEFAULT '[]' |
| evaluation_criteria | JSONB | NOT NULL, DEFAULT '[]' |
| taba_allowed | BOOLEAN | |
| indirect_rate_cap | NUMERIC | |
| partner_max_pct | NUMERIC | |
| cost_sharing_required | BOOLEAN | DEFAULT false |
| cost_volume_format | TEXT | |
| pi_must_be_employee | BOOLEAN | |
| pi_university_allowed | BOOLEAN | |
| clearance_required | TEXT | |
| itar_required | BOOLEAN | DEFAULT false |
| far_clauses | TEXT[] | DEFAULT '{}' |
| custom_variables | JSONB | DEFAULT '{}' |
| verified_by | UUID | FK users(id) ON DELETE SET NULL |
| verified_at | TIMESTAMPTZ | |
| topic_id | UUID | FK opportunities(id) ON DELETE CASCADE |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### solicitation_documents
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL, FK curated_solicitations(id) ON DELETE CASCADE |
| document_type | TEXT | NOT NULL, DEFAULT 'source', CHECK IN ('source','rfp','nofo','instructions','amendment','qa','template','supporting','attachment','topic','other') |
| original_filename | TEXT | NOT NULL |
| storage_key | TEXT | NOT NULL, UNIQUE |
| file_size | BIGINT | |
| content_type | TEXT | |
| page_count | INTEGER | |
| extracted_text | TEXT | |
| extracted_at | TIMESTAMPTZ | |
| uploaded_by | UUID | FK users(id) ON DELETE SET NULL |
| metadata | JSONB | NOT NULL, DEFAULT '{}' |
| content_hash | TEXT | UNIQUE (where NOT NULL) |
| is_primary | BOOLEAN | NOT NULL, DEFAULT false |
| document_label | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### solicitation_outlines
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL, FK curated_solicitations(id) |
| outline | JSONB | NOT NULL |
| notes | TEXT | |
| created_by | UUID | FK users(id) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### solicitation_templates
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | FK curated_solicitations(id) |
| namespace | TEXT | |
| document_name | TEXT | NOT NULL |
| document_type | TEXT | NOT NULL |
| file_path | TEXT | NOT NULL |
| file_hash | TEXT | |
| uploaded_by | UUID | FK users(id) ON DELETE SET NULL |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### solicitation_volumes
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL, FK curated_solicitations(id) ON DELETE CASCADE |
| volume_number | INTEGER | NOT NULL |
| volume_name | TEXT | NOT NULL |
| volume_format | TEXT | DEFAULT 'custom', CHECK IN ('dsip_standard','l_and_m','custom') |
| description | TEXT | |
| special_requirements | TEXT[] | NOT NULL, DEFAULT '{}' |
| metadata | JSONB | NOT NULL, DEFAULT '{}' |
| created_by | UUID | FK users(id) ON DELETE SET NULL |
| applies_to_phase | TEXT[] | |
| topic_id | UUID | FK opportunities(id) ON DELETE CASCADE |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | UNIQUE(solicitation_id, COALESCE(topic_id, sentinel), volume_number) via index |

### source_diffs
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| profile_id | UUID | NOT NULL, FK source_profiles(id) ON DELETE CASCADE |
| region_id | UUID | FK source_regions(id) |
| prev_snapshot_id | UUID | FK source_snapshots(id) |
| next_snapshot_id | UUID | FK source_snapshots(id) |
| is_meaningful | BOOLEAN | DEFAULT false |
| summary | TEXT | |
| extracted_opportunities | JSONB | DEFAULT '[]' |
| severity | TEXT | DEFAULT 'info', CHECK IN ('info','low','medium','high','critical') |
| claude_model | TEXT | |
| claude_tokens_used | INT | |
| reviewed_by | UUID | FK users(id) |
| reviewed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

### source_profiles
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| site_type | TEXT | NOT NULL, DEFAULT 'custom', CHECK IN ('dsip','sam_gov','sbir_gov','grants_gov','afwerx','xtech','nsf','custom') |
| base_url | TEXT | NOT NULL |
| bookmark_url | TEXT | |
| agency | TEXT | |
| program_type | TEXT | |
| admin_notes | TEXT | |
| visit_instructions | TEXT | |
| topic_url_pattern | TEXT | |
| pdf_url_pattern | TEXT | |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| last_visited_at | TIMESTAMPTZ | |
| last_visited_by | UUID | FK users(id) |
| created_by | UUID | FK users(id) |
| auto_crawl_enabled | BOOLEAN | DEFAULT false |
| crawl_cron | TEXT | DEFAULT '0 6 * * *' |
| last_crawl_at | TIMESTAMPTZ | |
| crawl_config | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### source_regions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| profile_id | UUID | NOT NULL, FK source_profiles(id) ON DELETE CASCADE |
| name | TEXT | NOT NULL |
| selector_hint | TEXT | |
| content_context | TEXT | |
| region_type | TEXT | DEFAULT 'content', CHECK IN ('content','listing','download','navigation','table') |
| sample_html | TEXT | |
| sample_text | TEXT | |
| is_active | BOOLEAN | DEFAULT true |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### source_snapshots
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| profile_id | UUID | NOT NULL, FK source_profiles(id) ON DELETE CASCADE |
| region_id | UUID | FK source_regions(id) ON DELETE SET NULL |
| content_hash | TEXT | NOT NULL |
| content_text | TEXT | |
| raw_html_s3_key | TEXT | |
| captured_at | TIMESTAMPTZ | DEFAULT now() |

### source_visits
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| profile_id | UUID | NOT NULL, FK source_profiles(id) ON DELETE CASCADE |
| visited_by | UUID | FK users(id) |
| action | TEXT | NOT NULL, CHECK IN ('visit','download','upload','paste_topics','import_topics','shred','note') |
| url | TEXT | |
| notes | TEXT | |
| files_count | INTEGER | DEFAULT 0 |
| topics_count | INTEGER | DEFAULT 0 |
| metadata | JSONB | NOT NULL, DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### spotlights
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| name | TEXT | NOT NULL |
| description | TEXT | |
| naics_codes | TEXT[] | DEFAULT '{}' |
| keywords | TEXT[] | DEFAULT '{}' |
| agencies | TEXT[] | DEFAULT '{}' |
| program_types | TEXT[] | DEFAULT '{}' |
| min_score | INT | DEFAULT 0 |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### system_config
| Column | Type | Constraints |
|--------|------|-------------|
| key | TEXT | PK |
| value | TEXT | NOT NULL |
| description | TEXT | |
| deploy_environment | TEXT | DEFAULT 'production' |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### system_events
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| namespace | TEXT | NOT NULL |
| type | TEXT | NOT NULL |
| phase | TEXT | NOT NULL, CHECK IN ('start','end','single') |
| actor_type | TEXT | NOT NULL, CHECK IN ('user','system','pipeline','agent') |
| actor_id | TEXT | NOT NULL |
| actor_email | TEXT | |
| tenant_id | UUID | FK tenants(id) |
| parent_event_id | UUID | FK system_events(id) |
| payload | JSONB | NOT NULL, DEFAULT '{}' |
| error | JSONB | |
| duration_ms | INTEGER | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### system_health_snapshots
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| captured_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| queue_depth | INTEGER | NOT NULL, DEFAULT 0 |
| events_last_hour | INTEGER | NOT NULL, DEFAULT 0 |
| errors_last_hour | INTEGER | NOT NULL, DEFAULT 0 |
| db_reachable | BOOLEAN | NOT NULL, DEFAULT true |
| s3_reachable | BOOLEAN | NOT NULL, DEFAULT true |
| notes | JSONB | DEFAULT '{}' |

### tenant_actions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| opportunity_id | UUID | NOT NULL, FK opportunities(id) |
| user_id | UUID | NOT NULL, FK users(id) |
| action_type | TEXT | NOT NULL, CHECK IN ('thumbs_up','thumbs_down','pin','unpin','comment','status_change') |
| metadata | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### tenant_agent_config
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | UNIQUE, NOT NULL, FK tenants(id) |
| enabled_agents | TEXT[] | DEFAULT '{}' |
| monthly_budget | NUMERIC(10,2) | DEFAULT 50.00 |
| monthly_used | NUMERIC(10,2) | DEFAULT 0.00 |
| preferences | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### tenant_pipeline_items
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| opportunity_id | UUID | NOT NULL, FK opportunities(id) |
| total_score | INT | NOT NULL, DEFAULT 0 |
| naics_score | INT | DEFAULT 0 |
| keyword_score | INT | DEFAULT 0 |
| agency_score | INT | DEFAULT 0 |
| set_aside_score | INT | DEFAULT 0 |
| type_score | INT | DEFAULT 0 |
| timeline_score | INT | DEFAULT 0 |
| llm_adjustment | INT | DEFAULT 0, CHECK BETWEEN -15 AND 15 |
| llm_rationale | TEXT | |
| priority_tier | TEXT | GENERATED ALWAYS AS (CASE WHEN total_score >= 75 THEN 'high' WHEN total_score >= 50 THEN 'medium' ELSE 'low' END) STORED |
| pursuit_status | TEXT | NOT NULL, DEFAULT 'unreviewed', CHECK IN ('unreviewed','pursuing','monitoring','passed') |
| recommendation | TEXT | |
| matched_keywords | TEXT[] | DEFAULT '{}' |
| is_pinned | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | UNIQUE(tenant_id, opportunity_id) |

### tenant_profiles
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | UNIQUE, NOT NULL, FK tenants(id) |
| naics_codes | TEXT[] | DEFAULT '{}' |
| keywords | TEXT[] | DEFAULT '{}' |
| agency_priorities | TEXT[] | DEFAULT '{}' |
| set_aside_types | TEXT[] | DEFAULT '{}' |
| technology_focus | TEXT | |
| company_summary | TEXT | |
| research_areas | TEXT[] | DEFAULT '{}' |
| target_agencies | TEXT[] | DEFAULT '{}' |
| min_surface_score | INT | DEFAULT 40 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### tenant_uploads
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tenant_id | UUID | NOT NULL, FK tenants(id) |
| file_name | TEXT | NOT NULL |
| file_path | TEXT | NOT NULL |
| file_size | BIGINT | |
| mime_type | TEXT | |
| uploaded_by | UUID | FK users(id) |
| processed | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### tenants
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| slug | TEXT | UNIQUE, NOT NULL |
| name | TEXT | NOT NULL |
| legal_name | TEXT | |
| website | TEXT | |
| status | TEXT | NOT NULL, DEFAULT 'trial', CHECK IN ('active','suspended','churned','trial') |
| product_tier | TEXT | NOT NULL, DEFAULT 'finder', CHECK IN ('finder','reminder','binder','grinder') |
| billing_email | TEXT | |
| trial_ends_at | TIMESTAMPTZ | |
| storage_root | TEXT | |
| stripe_customer_id | TEXT | |
| subscription_status | TEXT | NOT NULL, DEFAULT 'none', CHECK IN ('none','active','past_due','canceled') |
| lifecycle_stage | TEXT | DEFAULT 'customer', CHECK IN ('lead','target','customer','at_risk','churned') |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### tool_invocation_metrics
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| tool_name | TEXT | NOT NULL |
| tool_namespace | TEXT | NOT NULL |
| actor_type | TEXT | NOT NULL, CHECK IN ('user','system','pipeline','agent') |
| actor_id | TEXT | NOT NULL |
| tenant_id | UUID | FK tenants(id) |
| success | BOOLEAN | NOT NULL |
| error_code | TEXT | |
| duration_ms | INTEGER | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### triage_actions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| solicitation_id | UUID | NOT NULL, FK curated_solicitations(id) ON DELETE CASCADE |
| actor_id | UUID | NOT NULL, FK users(id) |
| action | TEXT | NOT NULL, CHECK IN ('claim','release','dismiss','request_review','approve','reject','push','reclaim','skip_shredder','return_to_curation') |
| from_state | TEXT | NOT NULL |
| to_state | TEXT | NOT NULL |
| notes | TEXT | |
| metadata | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| email | TEXT | UNIQUE, NOT NULL |
| name | TEXT | |
| role | TEXT | NOT NULL, DEFAULT 'tenant_user', CHECK IN ('master_admin','rfp_admin','tenant_admin','tenant_user','partner_user') |
| tenant_id | UUID | FK tenants(id) |
| password_hash | TEXT | |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| temp_password | BOOLEAN | NOT NULL, DEFAULT false |
| last_login_at | TIMESTAMPTZ | |
| terms_accepted_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### verification_tokens
| Column | Type | Constraints |
|--------|------|-------------|
| identifier | TEXT | NOT NULL |
| token | TEXT | UNIQUE, NOT NULL |
| expires | TIMESTAMPTZ | NOT NULL |
| | | PK(identifier, token) |

### visitor_sessions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| session_id | TEXT | UNIQUE, NOT NULL |
| first_page | TEXT | |
| referrer | TEXT | |
| user_agent | TEXT | |
| ip_hash | TEXT | |
| device_type | TEXT | |
| country | TEXT | |
| last_seen_at | TIMESTAMPTZ | DEFAULT now() |
| page_count | INTEGER | DEFAULT 0 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### volume_required_items
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| volume_id | UUID | NOT NULL, FK solicitation_volumes(id) ON DELETE CASCADE |
| item_number | INTEGER | NOT NULL |
| item_name | TEXT | NOT NULL |
| item_type | TEXT | NOT NULL, DEFAULT 'word_doc', CHECK IN ('word_doc','slide_deck','spreadsheet','pdf','text','form_sf424','form_sbir_certs','form_other','other') |
| required | BOOLEAN | NOT NULL, DEFAULT true |
| page_limit | INTEGER | |
| slide_limit | INTEGER | |
| font_family | TEXT | |
| font_size | TEXT | |
| margins | TEXT | |
| line_spacing | TEXT | |
| header_format | TEXT | |
| footer_format | TEXT | |
| required_sections | JSONB | NOT NULL, DEFAULT '[]' |
| format_rules | JSONB | NOT NULL, DEFAULT '{}' |
| custom_fields | JSONB | NOT NULL, DEFAULT '{}' |
| source_excerpts | JSONB | NOT NULL, DEFAULT '[]' |
| metadata | JSONB | NOT NULL, DEFAULT '{}' |
| verified_by | UUID | FK users(id) ON DELETE SET NULL |
| verified_at | TIMESTAMPTZ | |
| applies_to_phase | TEXT[] | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | UNIQUE(volume_id, item_number) |

### waitlist
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| email | TEXT | UNIQUE, NOT NULL |
| company_name | TEXT | |
| metadata | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### Views

#### solicitation_summary
Joins `curated_solicitations` with `opportunities` to provide umbrella-level display with topic counts.

### Dropped Tables

- **solicitation_topics** — Dropped in migration 035/030a. Topics are now stored as rows in `opportunities` with `solicitation_id` FK.

---

## CMS Postgres Database

### _crm_metadata
| Column | Type | Constraints |
|--------|------|-------------|
| key | TEXT | PK |
| value | TEXT | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### admin_todos
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| title | TEXT | NOT NULL |
| description | TEXT | |
| todo_type | TEXT | NOT NULL, CHECK IN ('curation','support','content_review','campaign','general') |
| priority | TEXT | NOT NULL, DEFAULT 'medium', CHECK IN ('critical','high','medium','low') |
| status | TEXT | NOT NULL, DEFAULT 'open', CHECK IN ('open','in_progress','done','dismissed') |
| assigned_to | UUID | |
| tenant_id | UUID | |
| related_entity_type | TEXT | |
| related_entity_id | UUID | |
| due_at | TIMESTAMPTZ | |
| metadata | JSONB | DEFAULT '{}' |
| created_by | UUID | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |
| completed_at | TIMESTAMPTZ | |

### campaign_execution_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| campaign_id | UUID | NOT NULL, FK email_campaigns(id) |
| execution_type | TEXT | NOT NULL, CHECK IN ('one_time','recurring','drip_step') |
| step_number | INT | |
| recipients_targeted | INT | DEFAULT 0 |
| sends_created | INT | DEFAULT 0 |
| errors | INT | DEFAULT 0 |
| started_at | TIMESTAMPTZ | DEFAULT now() |
| completed_at | TIMESTAMPTZ | |
| metadata | JSONB | DEFAULT '{}' |

### cms_config
| Column | Type | Constraints |
|--------|------|-------------|
| key | TEXT | PK |
| value | JSONB | NOT NULL, DEFAULT '{}' |
| description | TEXT | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### cms_events
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| event_type | TEXT | NOT NULL |
| entity_type | TEXT | NOT NULL, DEFAULT 'post' |
| entity_id | UUID | |
| user_id | TEXT | |
| source | TEXT | NOT NULL, DEFAULT 'cms_service' |
| diff_summary | TEXT | |
| payload | JSONB | NOT NULL, DEFAULT '{}' |
| bridged | BOOLEAN | NOT NULL, DEFAULT false |
| bridged_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### cms_generations
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| prompt | TEXT | NOT NULL |
| category | TEXT | NOT NULL, DEFAULT 'tip' |
| model | TEXT | NOT NULL, DEFAULT 'claude-sonnet-4-20250514' |
| system_prompt | TEXT | |
| temperature | NUMERIC(3,2) | NOT NULL, DEFAULT 0.7 |
| status | TEXT | NOT NULL, DEFAULT 'pending', CHECK IN ('pending','generating','completed','failed','accepted','rejected') |
| generated_title | TEXT | |
| generated_excerpt | TEXT | |
| generated_body | TEXT | |
| generated_tags | TEXT[] | NOT NULL, DEFAULT '{}' |
| generated_meta | JSONB | NOT NULL, DEFAULT '{}' |
| post_id | UUID | FK cms_posts(id) ON DELETE SET NULL |
| requested_by | TEXT | |
| tokens_used | INT | |
| duration_ms | INT | |
| error_message | TEXT | |
| retry_count | INT | NOT NULL, DEFAULT 0 |
| source_type | TEXT | DEFAULT 'prompt', CHECK IN ('prompt','url','email','screenshot','repackage') |
| source_url | TEXT | |
| source_email_id | UUID | |
| source_content | TEXT | |
| attachments | TEXT[] | DEFAULT '{}' |
| tenant_id | UUID | |
| requested_by_email | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| completed_at | TIMESTAMPTZ | |

### cms_media
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| filename | TEXT | NOT NULL |
| storage_path | TEXT | NOT NULL, UNIQUE |
| content_type | TEXT | NOT NULL |
| size_bytes | BIGINT | NOT NULL, DEFAULT 0 |
| width | INT | |
| height | INT | |
| alt_text | TEXT | |
| caption | TEXT | |
| post_id | UUID | FK cms_posts(id) ON DELETE SET NULL |
| usage | TEXT | NOT NULL, DEFAULT 'attachment', CHECK IN ('featured_image','inline','attachment','og_image') |
| uploaded_by | TEXT | |
| uploaded_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### cms_posts
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| slug | TEXT | NOT NULL, UNIQUE |
| title | TEXT | NOT NULL |
| excerpt | TEXT | |
| body | TEXT | NOT NULL, DEFAULT '' |
| body_format | TEXT | NOT NULL, DEFAULT 'markdown', CHECK IN ('markdown','html','plaintext') |
| category | TEXT | NOT NULL, DEFAULT 'tip' |
| tags | TEXT[] | NOT NULL, DEFAULT '{}' |
| status | TEXT | NOT NULL, DEFAULT 'draft', CHECK IN ('draft','in_review','approved','rejected','published','reverted','archived') |
| author_id | TEXT | |
| author_name | TEXT | |
| author_email | TEXT | |
| featured_image_id | UUID | FK cms_media(id) ON DELETE SET NULL |
| featured_image_url | TEXT | |
| generation_id | UUID | FK cms_generations(id) ON DELETE SET NULL |
| generated_by_model | TEXT | |
| generation_prompt | TEXT | |
| reviewed_by | TEXT | |
| reviewed_at | TIMESTAMPTZ | |
| review_notes | TEXT | |
| published_at | TIMESTAMPTZ | |
| published_by | TEXT | |
| unpublished_at | TIMESTAMPTZ | |
| meta_title | TEXT | |
| meta_description | TEXT | |
| canonical_url | TEXT | |
| og_image_url | TEXT | |
| version | INT | NOT NULL, DEFAULT 1 |
| previous_body | TEXT | |
| previous_title | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### cms_reviews
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| post_id | UUID | NOT NULL, FK cms_posts(id) ON DELETE CASCADE |
| action | TEXT | NOT NULL, CHECK IN ('submit_review','approve','reject','request_changes','publish','unpublish','revert','archive') |
| reviewer_id | TEXT | NOT NULL |
| reviewer_email | TEXT | |
| notes | TEXT | |
| title_snapshot | TEXT | |
| body_snapshot | TEXT | |
| version_at_review | INT | NOT NULL, DEFAULT 1 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### drip_enrollments
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| campaign_id | UUID | NOT NULL, FK email_campaigns(id) |
| tenant_id | UUID | |
| recipient_email | TEXT | NOT NULL |
| recipient_name | TEXT | |
| current_step | INT | NOT NULL, DEFAULT 0 |
| status | TEXT | NOT NULL, DEFAULT 'active', CHECK IN ('active','completed','paused','cancelled','failed') |
| enrolled_at | TIMESTAMPTZ | DEFAULT now() |
| next_send_at | TIMESTAMPTZ | |
| last_sent_at | TIMESTAMPTZ | |
| metadata | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### drip_sequences
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| campaign_id | UUID | NOT NULL, FK email_campaigns(id) ON DELETE CASCADE |
| step_number | INT | NOT NULL |
| template_id | UUID | FK email_templates(id) |
| subject_override | TEXT | |
| body_override | TEXT | |
| delay_hours | INT | NOT NULL, DEFAULT 0 |
| delay_from | TEXT | NOT NULL, DEFAULT 'enrollment', CHECK IN ('enrollment','previous_step') |
| condition_filter | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| | | UNIQUE(campaign_id, step_number) |

### email_accounts
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| email_address | TEXT | NOT NULL, UNIQUE |
| display_name | TEXT | NOT NULL |
| account_type | TEXT | NOT NULL, DEFAULT 'sweep', CHECK IN ('sweep','support','marketing','notifications') |
| credentials_encrypted | BYTEA | |
| credentials_type | TEXT | NOT NULL, DEFAULT 'service_account', CHECK IN ('service_account','oauth2','delegated') |
| delegate_subject | TEXT | |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| daily_send_limit | INT | NOT NULL, DEFAULT 500 |
| sends_today | INT | NOT NULL, DEFAULT 0 |
| sends_today_reset | DATE | NOT NULL, DEFAULT CURRENT_DATE |
| sweep_enabled | BOOLEAN | NOT NULL, DEFAULT false |
| sweep_inbox | BOOLEAN | NOT NULL, DEFAULT true |
| sweep_sent | BOOLEAN | NOT NULL, DEFAULT true |
| last_sweep_at | TIMESTAMPTZ | |
| sweep_history_id | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### email_campaigns
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| name | TEXT | NOT NULL |
| description | TEXT | |
| campaign_type | TEXT | NOT NULL, DEFAULT 'one_time', CHECK IN ('one_time','recurring','triggered','drip','support') |
| template_id | UUID | FK email_templates(id) ON DELETE SET NULL |
| account_id | UUID | FK email_accounts(id) ON DELETE SET NULL |
| audience_type | TEXT | NOT NULL, DEFAULT 'all_active', CHECK IN ('all_active','segment','individual','tier_based') |
| audience_filter | JSONB | NOT NULL, DEFAULT '{}' |
| status | TEXT | NOT NULL, DEFAULT 'draft', CHECK IN ('draft','scheduled','active','paused','completed','cancelled') |
| scheduled_at | TIMESTAMPTZ | |
| cron_expression | TEXT | |
| timezone | TEXT | NOT NULL, DEFAULT 'UTC' |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| trigger_event | TEXT | |
| trigger_delay_hours | INT | DEFAULT 0 |
| total_sent | INT | NOT NULL, DEFAULT 0 |
| total_delivered | INT | NOT NULL, DEFAULT 0 |
| total_opened | INT | NOT NULL, DEFAULT 0 |
| total_clicked | INT | NOT NULL, DEFAULT 0 |
| total_replied | INT | NOT NULL, DEFAULT 0 |
| total_bounced | INT | NOT NULL, DEFAULT 0 |
| total_unsubscribed | INT | NOT NULL, DEFAULT 0 |
| created_by | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### email_engagement
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| send_id | UUID | NOT NULL, FK email_sends(id) ON DELETE CASCADE |
| campaign_id | UUID | FK email_campaigns(id) ON DELETE SET NULL |
| engagement_type | TEXT | NOT NULL, CHECK IN ('open','click','reply','bounce','unsubscribe','complaint','forward') |
| metadata | JSONB | NOT NULL, DEFAULT '{}' |
| reply_body | TEXT | |
| reply_sentiment | TEXT | CHECK IN ('positive','neutral','negative','urgent', NULL) |
| reply_intent | TEXT | CHECK IN ('question','interest','complaint','unsubscribe','out_of_office','decline','help_request','feedback','urgent','other', NULL) |
| reply_interpreted | BOOLEAN | NOT NULL, DEFAULT false |
| reply_interpreted_at | TIMESTAMPTZ | |
| tenant_id | TEXT | |
| user_id | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### email_outbox
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| send_id | UUID | NOT NULL, UNIQUE, FK email_sends(id) ON DELETE CASCADE |
| status | TEXT | NOT NULL, DEFAULT 'pending', CHECK IN ('pending','claimed','approved','rejected') |
| claimed_by | TEXT | |
| claimed_by_name | TEXT | |
| claimed_by_account_id | UUID | FK email_accounts(id) |
| claimed_at | TIMESTAMPTZ | |
| reviewed_by | TEXT | |
| reviewed_at | TIMESTAMPTZ | |
| review_notes | TEXT | |
| priority | INT | NOT NULL, DEFAULT 50 |
| category | TEXT | |
| recipient_preview | TEXT | |
| subject_preview | TEXT | |
| default_account_id | UUID | FK email_accounts(id) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### email_queue
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| send_id | UUID | NOT NULL, FK email_sends(id) ON DELETE CASCADE |
| priority | INT | NOT NULL, DEFAULT 50 |
| scheduled_for | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| attempts | INT | NOT NULL, DEFAULT 0 |
| max_attempts | INT | NOT NULL, DEFAULT 3 |
| locked_at | TIMESTAMPTZ | |
| locked_by | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### email_sends
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| campaign_id | UUID | FK email_campaigns(id) ON DELETE SET NULL |
| template_id | UUID | FK email_templates(id) ON DELETE SET NULL |
| account_id | UUID | FK email_accounts(id) ON DELETE SET NULL |
| recipient_email | TEXT | NOT NULL |
| recipient_name | TEXT | |
| tenant_id | TEXT | |
| user_id | TEXT | |
| subject | TEXT | NOT NULL |
| body_html | TEXT | |
| body_text | TEXT | |
| template_variables | JSONB | NOT NULL, DEFAULT '{}' |
| gmail_message_id | TEXT | |
| gmail_thread_id | TEXT | |
| in_reply_to | TEXT | |
| status | TEXT | NOT NULL, DEFAULT 'pending_approval', CHECK IN ('pending_approval','queued','sending','sent','delivered','bounced','failed','rejected') |
| sent_at | TIMESTAMPTZ | |
| delivered_at | TIMESTAMPTZ | |
| bounced_at | TIMESTAMPTZ | |
| error_message | TEXT | |
| retry_count | INT | NOT NULL, DEFAULT 0 |
| approved_by | TEXT | |
| approved_at | TIMESTAMPTZ | |
| approved_by_account_id | UUID | FK email_accounts(id) |
| rejection_reason | TEXT | |
| rejected_by | TEXT | |
| rejected_at | TIMESTAMPTZ | |
| original_subject | TEXT | |
| original_body_html | TEXT | |
| original_body_text | TEXT | |
| was_modified | BOOLEAN | NOT NULL, DEFAULT false |
| trigger_metadata | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### email_templates
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| name | TEXT | NOT NULL |
| slug | TEXT | NOT NULL, UNIQUE |
| description | TEXT | |
| category | TEXT | NOT NULL, DEFAULT 'transactional', CHECK IN ('transactional','campaign','spotlight','nudge','support','digest','onboarding','update') |
| subject_template | TEXT | NOT NULL |
| body_html | TEXT | NOT NULL, DEFAULT '' |
| body_text | TEXT | NOT NULL, DEFAULT '' |
| ai_drafted | BOOLEAN | NOT NULL, DEFAULT false |
| ai_prompt | TEXT | |
| ai_model | TEXT | |
| ai_drafted_at | TIMESTAMPTZ | |
| variables | JSONB | NOT NULL, DEFAULT '[]' |
| tags | TEXT[] | NOT NULL, DEFAULT '{}' |
| version | INT | NOT NULL, DEFAULT 1 |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| trigger_config | JSONB | DEFAULT '{}' |
| response_map | JSONB | DEFAULT '{}' |
| profile_variables | TEXT[] | DEFAULT '{}' |
| template_category | TEXT | DEFAULT 'outreach', CHECK IN ('outreach','response','drip','notification','digest','system','follow_up') |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

### email_threads
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() |
| gmail_thread_id | TEXT | NOT NULL |
| account_id | UUID | NOT NULL, FK email_accounts(id) ON DELETE CASCADE |
| recipient_email | TEXT | NOT NULL |
| tenant_id | TEXT | |
| user_id | TEXT | |
| subject | TEXT | |
| message_count | INT | NOT NULL, DEFAULT 0 |
| last_message_at | TIMESTAMPTZ | |
| last_sender | TEXT | |
| status | TEXT | NOT NULL, DEFAULT 'active', CHECK IN ('active','closed','waiting_reply','needs_attention') |
| campaign_id | UUID | FK email_campaigns(id) ON DELETE SET NULL |
| tags | TEXT[] | NOT NULL, DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| | | UNIQUE(gmail_thread_id, account_id) |

### social_accounts
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| platform | TEXT | NOT NULL, CHECK IN ('linkedin','twitter','facebook','instagram') |
| account_name | TEXT | NOT NULL |
| platform_account_id | TEXT | |
| access_token | TEXT | |
| refresh_token | TEXT | |
| token_expires_at | TIMESTAMPTZ | |
| tenant_id | UUID | |
| status | TEXT | NOT NULL, DEFAULT 'active', CHECK IN ('active','expired','revoked','disconnected') |
| metadata | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### social_posts
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| content_id | UUID | |
| social_account_id | UUID | NOT NULL, FK social_accounts(id) |
| platform | TEXT | NOT NULL |
| post_text | TEXT | NOT NULL |
| media_urls | TEXT[] | |
| link_url | TEXT | |
| scheduled_at | TIMESTAMPTZ | |
| posted_at | TIMESTAMPTZ | |
| platform_post_id | TEXT | |
| status | TEXT | NOT NULL, DEFAULT 'draft', CHECK IN ('draft','scheduled','posting','posted','failed') |
| engagement_data | JSONB | DEFAULT '{}' |
| error_message | TEXT | |
| retry_count | INT | DEFAULT 0 |
| created_by | UUID | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |
