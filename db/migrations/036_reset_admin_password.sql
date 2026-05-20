-- Reset master admin password to known credential and force password change
UPDATE users
SET password_hash = '$2a$12$J2tXetLD6aclcnQ1UqQh6.AqB8NwDe7DoKczYvgDwOwq.y0uHHzta',
    temp_password = true
WHERE email = 'eric@rfppipeline.com';
