-- Reset master admin password (036 had wrong hash due to shell escaping)
-- Password: !WagsAdmin2026 (14 chars, meets 12-char validation minimum)
UPDATE users
SET password_hash = '$2a$12$O4jjNVvovo69Z9BiVDFrDOPovEOTC4f/mMwoxb4F2mDDVB1jWuZ3W',
    temp_password = true
WHERE email = 'eric@rfppipeline.com';
