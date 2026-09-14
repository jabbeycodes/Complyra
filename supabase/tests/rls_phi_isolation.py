#!/usr/bin/env python3
"""RLS cross-agency isolation verification for PHI-bearing tables.

Proves that a user of agency B (test agency) cannot read or write rows that
belong to agency A (Evergreen Care) — for every PHI-bearing table — and that
the same user CAN read their own agency's rows (so the test is not vacuous).

Safety: every write attempt runs inside an explicit transaction that is
rolled back, so even a failed assertion leaves production untouched. The
test agency / user / membership rows are created by the setup step and
removed by the teardown step; all ids use a fixed ZZZ prefix.

Usage: python3 rls_phi_isolation.py [--setup-only | --teardown-only]

Reads SUPABASE credentials through the same dynamic-credential surrogate the
repo's skills use (custom.supabase on api.supabase.com).
"""
import json
import sys
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request  # noqa: E402

PROJECT_REF = "ynjthbdfuzkqrbvjuvwd"
URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

# Agency A = the real seeded demo agency; Agency B = the throwaway test agency.
AGENCY_A = "00000000-0000-4000-8000-000000000001"  # Evergreen Care
SITE_A = "00000000-0000-4000-8000-000000000011"
INDIVIDUAL_A = "00000000-0000-4000-8000-000000000101"
USER_A_ADMIN = "00000000-0000-4000-8000-000000000201"  # Evergreen administrator

AGENCY_B = "b0000000-0000-4000-8000-000000000001"
PROGRAM_B = "b0000000-0000-4000-8000-000000000002"
SITE_B = "b0000000-0000-4000-8000-000000000003"
INDIVIDUAL_B = "b0000000-0000-4000-8000-000000000004"
USER_B = "b0000000-0000-4000-8000-000000000005"  # test administrator of agency B

TABLES = [
    "individuals", "individual_profiles", "chart_files", "medications",
    "medication_deliveries", "med_dose_exceptions", "prn_dose_logs",
    "med_inventory", "training_checklists", "training_signoffs",
    "training_countersignatures", "training_requirements", "staff_certificates",
    "obligations", "obligation_signatures", "delegation_acknowledgments",
    "delegation_training_materials", "individual_delegation_assignments",
    "documents", "document_uploads", "home_safety_reports", "site_reviews",
    "emergency_drills", "hm_weekly_checklists", "mileage_trips",
    "hm_dsp_reviews", "adaptive_equipment", "equipment_month_logs",
    "clinical_renewals", "site_facts",
]

# (table, insert_sql_template) — each must be fully valid so that ONLY the
# RLS WITH CHECK can reject it. {A} = agency A id.
INSERT_TESTS = [
    ("individuals",
     "insert into public.individuals (agency_id, site_id, full_name, date_of_birth)"
     f" values ('{{A}}', '{SITE_A}', 'ZZZ RLS PROBE', '2000-01-01')"),
    ("medications",
     "insert into public.medications (agency_id, individual_id, name)"
     f" values ('{{A}}', '{INDIVIDUAL_A}', 'ZZZ RLS PROBE')"),
    ("training_checklists",
     "insert into public.training_checklists (agency_id, individual_id, staff_user_id, staff_name)"
     f" values ('{{A}}', '{INDIVIDUAL_A}', '{USER_A_ADMIN}', 'ZZZ RLS PROBE')"),
    ("staff_certificates",
     "insert into public.staff_certificates (agency_id, user_id, cert_name, issued_on, expires_on, entered_by)"
     f" values ('{{A}}', '{USER_A_ADMIN}', 'ZZZ RLS PROBE', '2026-01-01', '2027-01-01', '{USER_A_ADMIN}')"),
    ("documents",
     "insert into public.documents (agency_id, individual_id, title)"
     f" values ('{{A}}', '{INDIVIDUAL_A}', 'ZZZ RLS PROBE')"),
]


def q(sql):
    """Run SQL as the postgres superuser; returns parsed JSON or raises."""
    req = urllib.request.Request(
        URL,
        data=json.dumps({"query": sql}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    add_surrogate_to_request(req, "custom.supabase",
                             allowed_hosts=["api.supabase.com"])
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        raise RuntimeError(f"HTTP {e.code}: {body}")


def as_user(uid, inner_sql):
    """Wrap inner_sql to run as the authenticated app user `uid`."""
    return (
        f"select set_config('request.jwt.claims', '{{\"sub\":\"{uid}\"}}', true);"
        f"set role authenticated;"
        f"{inner_sql.rstrip().rstrip(';')};"
        "reset role;"
    )


def setup():
    q(f"""
    insert into auth.users (id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values ('{USER_B}', 'authenticated', 'authenticated',
      'zzz-rls-admin@example.invalid', '!', now(), '{{}}', '{{}}')
    on conflict (id) do nothing;
    insert into public.agencies (id, name, agency_code, state_code)
    values ('{AGENCY_B}', 'ZZZ RLS Verify Agency', 'ZZZRLS-MO', 'MO')
    on conflict (id) do nothing;
    insert into public.programs (id, agency_id, name)
    values ('{PROGRAM_B}', '{AGENCY_B}', 'ZZZ RLS Program')
    on conflict (id) do nothing;
    insert into public.sites (id, agency_id, program_id, name)
    values ('{SITE_B}', '{AGENCY_B}', '{PROGRAM_B}', 'ZZZ RLS Site')
    on conflict (id) do nothing;
    insert into public.individuals (id, agency_id, site_id, full_name, date_of_birth)
    values ('{INDIVIDUAL_B}', '{AGENCY_B}', '{SITE_B}', 'ZZZ RLS Person', '2000-01-01')
    on conflict (id) do nothing;
    insert into public.profiles (id, full_name, email)
    values ('{USER_B}', 'ZZZ RLS Admin', 'zzz-rls-admin@example.invalid')
    on conflict (id) do nothing;
    insert into public.memberships (agency_id, user_id, role, role_key)
    values ('{AGENCY_B}', '{USER_B}', 'administrator', 'administrator')
    on conflict do nothing;
    select 'setup_ok';
    """)
    print("setup: test agency B + user created")


def teardown():
    q(f"""
    -- The test user is agency B's only administrator; the
    -- memberships_guard_last_administrator trigger would block a plain
    -- delete, so it is disabled for this teardown only (superuser).
    alter table public.memberships disable trigger memberships_guard_last_administrator;
    delete from public.memberships where user_id = '{USER_B}';
    alter table public.memberships enable trigger memberships_guard_last_administrator;
    delete from public.profiles where id = '{USER_B}';
    delete from public.individuals where id = '{INDIVIDUAL_B}';
    delete from public.sites where id = '{SITE_B}';
    delete from public.programs where id = '{PROGRAM_B}';
    delete from public.agencies where id = '{AGENCY_B}';
    delete from auth.users where id = '{USER_B}';
    select 'teardown_ok';
    """)
    print("teardown: test agency B + user removed")


def ret_col(table):
    """RETURNING column for the write probes (site_facts uses site_id)."""
    return "site_id" if table == "site_facts" else "id"


def main():
    failures = []
    coverage = {}

    # Baseline: how many agency-A rows exist per table (proves the read
    # tests are not vacuous).
    for t in TABLES:
        rows = q(f"select count(*) as n from public.{t} "
                 f"where agency_id = '{AGENCY_A}'")
        coverage[t] = rows[0]["n"]

    # Sanity: user B can read their own agency's row.
    rows = q(as_user(
        USER_B,
        f"select count(*) as n from public.individuals "
        f"where agency_id = '{AGENCY_B}'"))
    own = rows[-1]["n"] if isinstance(rows, list) else rows["n"]
    print(f"sanity: user B reads own agency individuals -> {own} "
          f"({'PASS' if own == 1 else 'FAIL'})")
    if own != 1:
        failures.append("sanity: user B cannot read own agency row")

    for t in TABLES:
        n_a = coverage[t]
        # 1. Cross-agency read must return zero rows.
        rows = q(as_user(
            USER_B,
            f"select count(*) as n from public.{t} "
            f"where agency_id = '{AGENCY_A}'"))
        seen = rows[-1]["n"]
        ok = seen == 0
        print(f"read   {t:35} agency-A rows={n_a:4} visible-to-B={seen} "
              f"{'PASS' if ok else 'FAIL'}")
        if not ok:
            failures.append(f"read: {t} leaked {seen} agency-A rows to B")

        # 2/3. Cross-agency update/delete must affect zero rows. Each runs
        # in its own rolled-back transaction: even a broken policy could
        # not persist a change.
        rc = ret_col(t)
        upd = q("begin;" + as_user(
            USER_B,
            f"with u as (update public.{t} set agency_id = agency_id "
            f"where agency_id = '{AGENCY_A}' returning {rc}) "
            f"select count(*) as n from u;") + "rollback;")
        n_upd = upd[-1]["n"]
        ok = n_upd == 0
        print(f"update {t:35} affected={n_upd} {'PASS' if ok else 'FAIL'}")
        if not ok:
            failures.append(f"update: {t} modified {n_upd} agency-A rows as B")

        dele = q("begin;" + as_user(
            USER_B,
            f"with d as (delete from public.{t} "
            f"where agency_id = '{AGENCY_A}' returning {rc}) "
            f"select count(*) as n from d;") + "rollback;")
        n_del = dele[-1]["n"]
        ok = n_del == 0
        print(f"delete {t:35} affected={n_del} {'PASS' if ok else 'FAIL'}")
        if not ok:
            failures.append(f"delete: {t} removed {n_del} agency-A rows as B")

    # 4. Cross-agency inserts must be rejected by the RLS WITH CHECK.
    for t, template in INSERT_TESTS:
        sql = "begin;" + as_user(USER_B, template.format(A=AGENCY_A) + ";") \
            + "rollback;"
        try:
            q(sql)
            print(f"insert {t:35} unexpectedly SUCCEEDED -> FAIL")
            failures.append(f"insert: {t} allowed cross-agency insert as B")
        except RuntimeError as e:
            blocked = "row-level security" in str(e).lower()
            print(f"insert {t:35} rejected "
                  f"({'PASS' if blocked else 'FAIL: ' + str(e)[:80]})")
            if not blocked:
                failures.append(f"insert: {t} failed for non-RLS reason: {e}")

    print()
    if failures:
        print(f"RESULT: FAIL ({len(failures)} failures)")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print(f"RESULT: PASS — {len(TABLES)} tables x read/update/delete + "
          f"{len(INSERT_TESTS)} insert rejections, "
          f"agency B isolated from agency A")


if __name__ == "__main__":
    if "--setup-only" in sys.argv:
        setup()
    elif "--teardown-only" in sys.argv:
        teardown()
    else:
        setup()
        try:
            main()
        finally:
            teardown()
