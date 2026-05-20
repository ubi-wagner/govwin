-- Fix admin login loop: set known password AND disable temp_password flag
-- temp_password = false so user is NOT forced to change on login
UPDATE users
SET password_hash = '$2a$12$ssn42wVJWhpMuJl9MFP8KeFKaTgkruKTwEHSK/aHu52YDBb2NdrE6',
    temp_password = false
WHERE email = 'eric@rfppipeline.com';
