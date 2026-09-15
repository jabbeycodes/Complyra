-- Delegation/document RPCs use ON CONFLICT (agency_id, dedupe_key).
-- PostgreSQL cannot infer the old partial index without a matching predicate.
-- A normal unique index preserves multiple NULL keys and supports both RPCs
-- and the edge-function upsert while retaining the same deduplication rule.
create unique index notifications_delivery_dedupe on public.notifications(agency_id,dedupe_key);
drop index public.notifications_dedupe_key_unique;
