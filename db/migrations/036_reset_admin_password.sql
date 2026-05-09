-- Reset master admin password to known credential and force password change
UPDATE users
SET password_hash = '$2a$12$oRwHLjVUx.z7542twbBfcuAKEeTPeG6JylLirRqMdXH9u47Vi/i1K',
    temp_password = true
WHERE email = 'eric@rfppipeline.com';
