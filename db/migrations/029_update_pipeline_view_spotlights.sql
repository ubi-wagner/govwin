-- =============================================================================
-- Migration 029 — Update tenant_pipeline view with SpotLight provenance fields
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW tenant_pipeline AS
SELECT
    to2.id AS tenant_opp_id, to2.tenant_id,
    o.id AS opportunity_id, o.source, o.source_id, o.solicitation_number,
    o.title, o.description, o.agency, o.agency_code, o.department, o.sub_tier, o.office,
    o.naics_codes, o.classification_code, o.set_aside_type, o.set_aside_code,
    o.opportunity_type, o.base_type, o.posted_date, o.close_date, o.archive_date,
    o.estimated_value_min, o.estimated_value_max, o.source_url, o.sam_ui_link,
    o.additional_info_link, o.resource_links, o.status AS opp_status, o.is_active,
    o.pop_city, o.pop_state, o.pop_country, o.pop_zip,
    o.contact_name, o.contact_email, o.contact_phone, o.contact_title,
    o.award_date, o.award_number, o.award_amount, o.awardee_name, o.awardee_uei,
    to2.total_score, to2.llm_adjustment, to2.llm_rationale,
    to2.matched_keywords, to2.matched_domains, to2.pursuit_status,
    to2.pursuit_recommendation, to2.key_requirements, to2.competitive_risks,
    to2.questions_for_rfi, to2.priority_tier, to2.scored_at,
    -- SpotLight provenance
    to2.matched_spotlight_ids, to2.best_spotlight_id, to2.best_spotlight_name,
    to2.pinned_from_spotlight_id,
    EXTRACT(DAY FROM (o.close_date - NOW()))::INT AS days_to_close,
    CASE
        WHEN o.close_date < NOW() THEN 'closed'
        WHEN o.close_date < NOW() + INTERVAL '7 days' THEN 'urgent'
        WHEN o.close_date < NOW() + INTERVAL '14 days' THEN 'soon'
        ELSE 'ok'
    END AS deadline_status,
    COALESCE(r.thumbs_up, 0) AS thumbs_up,
    COALESCE(r.thumbs_down, 0) AS thumbs_down,
    COALESCE(r.comment_count, 0) AS comment_count,
    COALESCE(r.is_pinned, 0) > 0 AS is_pinned,
    r.last_action_at,
    (SELECT COUNT(*) FROM documents d WHERE d.opportunity_id = o.id) AS doc_count,
    (SELECT COUNT(*) FROM amendments a WHERE a.opportunity_id = o.id) AS amendment_count
FROM tenant_opportunities to2
JOIN opportunities o ON o.id = to2.opportunity_id
LEFT JOIN tenant_opportunity_reactions r
    ON r.tenant_id = to2.tenant_id AND r.opportunity_id = o.id
WHERE o.status = 'active';

COMMIT;
