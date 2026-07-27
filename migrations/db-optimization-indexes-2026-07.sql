-- Database optimization indexes (reference DDL)
-- Prefer the idempotent runner (handles existing tables + orphan FK checks):
--   npm run db:run-optimization-indexes
--
-- This file documents the intended schema for review / manual DBA apply.
-- Do NOT run blindly on production if tables already exist without indexes —
-- use the Node runner instead.

-- Matrimony interests
-- ALTER TABLE matrimony_interests ADD UNIQUE KEY uq_matrimony_interest_pair (from_user_id, to_user_id);
-- ALTER TABLE matrimony_interests ADD KEY idx_interest_to_status (to_user_id, status);
-- ALTER TABLE matrimony_interests ADD KEY idx_interest_from_status (from_user_id, status);

-- Matrimony matches
-- ALTER TABLE matrimony_matches ADD UNIQUE KEY uq_matrimony_match_pair (user_low_id, user_high_id);
-- ALTER TABLE matrimony_matches ADD KEY idx_match_user_low (user_low_id, status);
-- ALTER TABLE matrimony_matches ADD KEY idx_match_user_high (user_high_id, status);

-- Monetization / safety / payments: see scripts/run-db-optimization-indexes.js

SELECT 'Use npm run db:run-optimization-indexes' AS instruction;
