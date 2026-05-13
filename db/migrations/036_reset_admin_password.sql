-- Reset master admin password to known credential and force password change
-- Password: !WagsAdmin2026 (14 chars, meets 12-char minimum)
UPDATE users
SET password_hash = '$2a$12$J2tXetLD6aclcnQ1UqQh6.AqB8NwDe7DoKczYvgDwOwq.y0uHHzta',
    temp_password = true
WHERE email = 'eric@rfppipeline.com';
