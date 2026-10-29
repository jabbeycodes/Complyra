import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync('supabase/migrations/20261027121000_care_plans_screening.sql', 'utf8');
test('care records have forced RLS and no direct authenticated writes', () => {
  for (const table of ['individual_care_plans', 'care_plan_acknowledgements', 'health_screening_types', 'individual_health_screenings']) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security`));
    assert.ok(sql.includes(`alter table public.${table} force row level security`));
  }
  assert.match(sql, /revoke insert,update,delete/);
  assert.match(sql, /private.can_read_individual\(agency_id,individual_id\)/);
  assert.match(sql, /status='active' and private.role_key_in\(agency_id,array\['dsp'\]\)/);
  assert.match(sql, /revoke all on function public.get_care_screening_data/);
});
test('plan lifecycle is serialized with unique active and draft versions and durable acknowledgements', () => {
  assert.match(sql, /care_one_active.*where status = 'active'/);
  assert.match(sql, /care_one_draft.*where status = 'draft'/);
  assert.match(sql, /from individuals where id=person_id and agency_id=p_agency_id for update/);
  assert.match(sql, /active_id is distinct from plan.previous_id/);
  assert.match(sql, /set status='revised',retired_at=now\(\)/);
  assert.match(sql, /primary key\(plan_id,user_id\)/);
});
test('scheduled reminder sweep targets current home staff and agency Program Managers with deduplication', () => {
  const sweep = sql.slice(sql.indexOf('create function public.sweep_care_screening'));
  assert.match(sweep, /m.site_id=i.site_id/);
  assert.match(sweep, /m.role_key='program_manager' and d.type<>'care.review_overdue'/);
  assert.match(sweep, /on conflict\(agency_id,dedupe_key\) do nothing/);
  assert.match(sweep, /auth.role\(\)='service_role' or private.has_agency/);
  assert.match(sweep, /s.completed_on is null/);
  const edge = readFileSync('supabase/functions/sweep-operating-reminders/index.ts', 'utf8');
  assert.match(edge, /rpc\("sweep_care_screening"/);
});
