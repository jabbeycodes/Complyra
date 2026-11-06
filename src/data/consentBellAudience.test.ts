/**
 * consentBellAudience.test.ts — Wave 4A (agency simulation retest
 * batches 305-306): consent alerts reached the house manager's bell but
 * not the administrator's or the nurse's.
 *
 * Administrator: the alerts were minted, but the RESTRICTIVE
 * consent_notification_roles policy on public.notifications (from
 * 20261027140000) never listed 'administrator', so every consent.* row
 * was invisible to an administrator session. Migration 20261105110000
 * adds it; the static test below pins the policy to the sweep's
 * role-addressed recipients (pgTAP: supabase/tests/consent_notice_admin_read.sql).
 *
 * Nurse: the bell fetched the newest 100 rows; her unread consent alerts
 * ranked ~367 under bulk read med rows. listNotifications now loads the
 * newest 100 PLUS every unread row (HostedApi and LocalApi).
 *
 * Run: node --import tsx --test src/data/consentBellAudience.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HostedApi } from './hostedApi';
import { LocalApi, MemoryStore } from './localApi';
import { createEvergreenSeed } from './seed';
import { DEFAULT_CONSENT_TYPES, consentAlertPairs, type ConsentRegister } from './consents';
import { centralTodayIso } from './menuRecords';
import { groupNotifications, windowNotifications, type NotificationRow } from '../features/notifications/notify';
import type { SessionUser } from './types';

const MIGRATIONS = 'supabase/migrations';

/** The LAST definition of a policy / function across migrations, in apply order. */
function latestDefinition(pattern: RegExp): { file: string; body: string } {
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
    let found: { file: string; body: string } | null = null;
    for (const file of files) {
        const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
        const all = [...sql.matchAll(pattern)];
        if (all.length) found = { file, body: all[all.length - 1][0] };
    }
    assert.ok(found, `no migration defines ${pattern}`);
    return found;
}

test('administrator: the consent notice read policy admits every role the sweep addresses', () => {
    const policy = latestDefinition(/create policy consent_notification_roles[\s\S]*?;/g);
    const readers = /'\{([^}]*)\}'/.exec(policy.body)?.[1].split(',').map(s => s.trim()) ?? [];
    const sweep = latestDefinition(/create or replace function private\.sweep_consents[\s\S]*?\$\$;/g);
    const roleTargets = [...sweep.body.matchAll(/select null::uuid,'([a-z_]+)'/g)].map(m => m[1]);
    assert.ok(roleTargets.includes('administrator'), 'the sweep addresses the administrator role (20261104120000)');
    assert.ok(/role_key='house_manager'/.test(sweep.body), 'the sweep addresses house managers directly');
    for (const role of [...roleTargets, 'house_manager'])
        assert.ok(readers.includes(role),
            `${policy.file}: consent_notification_roles must admit '${role}' — the sweep mints rows for it`);
    assert.ok(!readers.includes('auditor'), 'auditors stay excluded from consent notices');
    assert.match(policy.body, /as restrictive/, 'the policy stays restrictive');
    assert.equal(policy.file, '20261105110000_consent_notices_administrator_read.sql');
});

// ── Hosted fake ────────────────────────────────────────────────────────

type Row = Record<string, any>;

/** A tiny PostgREST-ish query builder over in-memory tables. */
function fakeClient(tables: Record<string, Row[]>, calls: string[]) {
    function builder(table: string) {
        let rows = [...(tables[table] ?? [])];
        let range: [number, number] | null = null;
        let limit: number | null = null;
        const sorts: { col: string; asc: boolean }[] = [];
        const b: any = {
            select: () => b,
            eq: (col: string, v: unknown) => { rows = rows.filter(r => r[col] === v); return b; },
            is: (col: string, v: unknown) => { rows = rows.filter(r => (r[col] ?? null) === v); calls.push(`${table}.is(${col})`); return b; },
            order: (col: string, o?: { ascending?: boolean }) => { sorts.push({ col, asc: o?.ascending !== false }); return b; },
            limit: (n: number) => { limit = n; calls.push(`${table}.limit(${n})`); return b; },
            range: (from: number, to: number) => { range = [from, to]; calls.push(`${table}.range(${from},${to})`); return b; },
            maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
            then: (resolve: (v: unknown) => void) => {
                let out = [...rows].sort((x, y) => {
                    for (const s of sorts) {
                        const c = String(x[s.col]).localeCompare(String(y[s.col]));
                        if (c) return s.asc ? c : -c;
                    }
                    return 0;
                });
                if (range) out = out.slice(range[0], range[1] + 1);
                if (limit !== null) out = out.slice(0, limit);
                resolve({ data: out, error: null });
            },
        };
        return b;
    }
    return {
        from: (table: string) => builder(table),
        rpc: async (name: string) => { calls.push(`rpc:${name}`); return { data: null, error: null }; },
    } as unknown as SupabaseClient;
}

const AGENCY = 'agency-1';
const NURSE = 'user-nurse';

function session(roleKey: string, userId: string): SessionUser {
    return {
        userId, email: `${roleKey}@example.invalid`, username: roleKey, fullName: roleKey, jobTitle: roleKey,
        role: roleKey, roleKey, agencyId: AGENCY, agencyName: 'Northstar', agencyCode: 'NS', siteId: null,
        mustChangePassword: false, expiresOn: null, permissions: {}, platformAdmin: false, agencyStatus: 'active',
    } as unknown as SessionUser;
}

/** ISO timestamp `minutes` before a fixed instant (newest = smallest offset). */
function at(minutes: number) {
    return new Date(Date.parse('2026-11-05T20:00:00Z') - minutes * 60_000).toISOString();
}

function noticeRow(id: string, minutesAgo: number, extra: Row = {}): Row {
    return {
        id, agency_id: AGENCY, user_id: null, role_key: 'nurse', type: 'med.prn_repeat', title: 'PRN follow-up still open',
        body: 'x', deep_link: '/mar', entity_type: 'medication', entity_id: 'med-1', dedupe_key: id,
        read_at: null, created_at: at(minutesAgo), notification_reads: [], ...extra,
    };
}

/** A register where Dana's medication consent is missing and her media consent is Active. */
function register(): ConsentRegister {
    const today = centralTodayIso();
    return {
        types: DEFAULT_CONSENT_TYPES,
        individuals: [{ id: 'dana', agencyId: AGENCY, siteId: 'site-1', fullName: 'Dana' }],
        records: [{
            id: 'c-media', agencyId: AGENCY, individualId: 'dana', typeId: 'media', covers: 'Photos.', giver: 'individual',
            giverName: 'Dana', relationship: 'Self', signedOn: today, effectiveOn: today, reviewOn: '2099-12-31',
            supersedesId: null, createdBy: 'hm', createdAt: `${today}T10:00:00Z`, activatedBy: 'hm', activatedAt: `${today}T10:00:00Z`,
        }],
        revocations: [],
    };
}

/**
 * The nurse's production shape (547 visible rows): her two unread consent
 * alerts sit under hundreds of newer read med rows — some read directly,
 * most role broadcasts read through notification_reads.
 */
function nurseFixture(clearSiteIds: string[] = []) {
    const rows: Row[] = [];
    for (let i = 0; i < 380; i++)
        rows.push(noticeRow(`prn-${i}`, i, { notification_reads: [{ read_at: at(i) }] }));
    for (let i = 0; i < 160; i++)
        rows.push(noticeRow(`unrec-${i}`, 380 + i, { user_id: NURSE, role_key: null, type: 'med.unrecorded', entity_type: 'site', entity_id: 'site-2', read_at: at(380 + i) }));
    // Unread, buried past rank 100.
    rows.push(noticeRow('consent-live', 600, { type: 'consent.missing', title: 'Consent needs attention', entity_type: 'consent', entity_id: 'dana:medication' }));
    rows.push(noticeRow('consent-resolved', 601, { type: 'consent.missing', title: 'Consent needs attention', entity_type: 'consent', entity_id: 'dana:media' }));
    rows.push(noticeRow('unrec-cleared', 602, { user_id: NURSE, role_key: null, type: 'med.unrecorded', entity_type: 'site', entity_id: 'site-1' }));
    rows.push(noticeRow('unrec-open-a', 603, { user_id: NURSE, role_key: null, type: 'med.unrecorded', entity_type: 'site', entity_id: 'site-3' }));
    rows.push(noticeRow('unrec-open-b', 604, { user_id: NURSE, role_key: null, type: 'med.unrecorded', entity_type: 'site', entity_id: 'site-3' }));
    const calls: string[] = [];
    const api = new HostedApi(fakeClient({ notifications: rows, individuals: [] }, calls));
    const internals = api as any;
    internals.getSession = async () => session('nurse', NURSE);
    internals.sweepOperatingReminders = async () => new Set(clearSiteIds);
    internals.getConsents = async () => register();
    internals.listConsentPackets = async () => [];
    return { api, calls, rows };
}

test('nurse (hosted): unread consent alerts buried past the newest 100 still load', async () => {
    const { api, calls } = nurseFixture();
    const listed = await api.listNotifications();
    const ids = listed.map(r => r.id);
    assert.ok(ids.includes('consent-live'), 'the unread consent alert at rank ~540 reaches the bell');
    // The newest-100 history the bell always showed is unchanged and leads the list.
    assert.deepEqual(ids.slice(0, 100), Array.from({ length: 100 }, (_, i) => `prn-${i}`));
    assert.ok(listed.slice(0, 100).every(r => r.read_at), 'broadcast reads still map from notification_reads');
    // Older READ history stays outside the window.
    assert.ok(!ids.includes('prn-150') && !ids.includes('unrec-10'));
    // Newest first throughout.
    const times = listed.map(r => Date.parse(r.created_at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.ok(calls.includes('notifications.limit(100)'));
    assert.ok(calls.includes('notifications.is(read_at)'), 'the unread pass filters on the row read_at');
});

test('nurse (hosted): stale-retirement still drops an alert whose consent is now Active', async () => {
    const { api } = nurseFixture();
    const ids = (await api.listNotifications()).map(r => r.id);
    assert.ok(ids.includes('consent-live'), 'the still-missing medication consent keeps its alert');
    assert.ok(!ids.includes('consent-resolved'), 'the media consent is Active, so its stored Missing alert retires');
});

test('nurse (hosted): Wave 7M retirement and med.unrecorded grouping hold on the unread pass', async () => {
    const { api } = nurseFixture(['site-1']);
    const listed = await api.listNotifications();
    const ids = listed.map(r => r.id);
    assert.ok(!ids.includes('unrec-cleared'), 'a cleared site retires its unmarked-dose row even when it loads from the unread pass');
    const group = groupNotifications(listed).find(g => g.key === 'med.unrecorded|site|site-3');
    assert.ok(group, 'the open site\'s unmarked rows group');
    assert.equal(group.rows.length, 2);
    assert.equal(group.unreadCount, 2);
});

test('hosted: a visible set under 100 rows makes no second pass', async () => {
    const calls: string[] = [];
    const api = new HostedApi(fakeClient({ notifications: [noticeRow('only', 1)] }, calls));
    const internals = api as any;
    internals.getSession = async () => session('dsp', 'user-dsp');
    internals.sweepOperatingReminders = async () => new Set();
    assert.deepEqual((await api.listNotifications()).map(r => r.id), ['only']);
    assert.ok(!calls.some(c => c.startsWith('notifications.range')));
});

test('windowNotifications: dedupes merged passes, keeps the newest N and every unread row', () => {
    const row = (id: string, minutesAgo: number, read: boolean) =>
        ({ ...noticeRow(id, minutesAgo), read_at: read ? at(minutesAgo) : null }) as unknown as NotificationRow;
    const rows = [row('a', 1, true), row('b', 2, true), row('c', 3, true), row('old-unread', 9, false), row('a', 1, true), row('old-read', 8, true)];
    assert.deepEqual(windowNotifications(rows, 2).map(r => r.id), ['a', 'b', 'old-unread']);
});

// ── LocalApi parity ───────────────────────────────────────────────────

test('nurse (local): an unread notice buried past the newest 100 still lists', async () => {
    const db = createEvergreenSeed();
    const store = new MemoryStore(db);
    const api = new LocalApi(store);
    const nurse = db.memberships.find(m => m.roleKey === 'nurse');
    assert.ok(nurse, 'the evergreen seed has a nurse');
    store.sessionUserId = nurse.userId;
    const base = { agencyId: nurse.agencyId, userId: nurse.userId, roleKey: null, title: 't', body: 'b', deepLink: '/', entityType: 'test' };
    db.notifications ??= [];
    db.notifications.push({ ...base, id: 'buried-unread', type: 'incident.followup', entityId: 'inc-1', dedupeKey: 'buried-unread', createdAt: '2000-01-01T00:00:00.000Z', readAt: null });
    for (let i = 0; i < 150; i++)
        db.notifications.push({ ...base, id: `read-${i}`, type: 'incident.followup', entityId: `inc-r${i}`, dedupeKey: `read-${i}`, createdAt: `2001-01-01T00:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}.000Z`, readAt: '2001-02-01T00:00:00.000Z' });
    const listed = await api.listNotifications();
    assert.ok(listed.some(r => r.id === 'buried-unread'), 'the old unread notice survives the window');
    assert.ok(listed.filter(r => r.id.startsWith('read-')).length < 150, 'old read history is still windowed');
});

// ── Central day ───────────────────────────────────────────────────────

test('consentAlertPairs judges the Central day, not the device day', () => {
    const saved = process.env.TZ;
    // UTC+14: the device date runs a day ahead of Chicago for 20 hours of every day.
    process.env.TZ = 'Pacific/Kiritimati';
    try {
        const today = centralTodayIso();
        const reg = register();
        reg.records[0] = { ...reg.records[0], effectiveOn: '2026-01-01', signedOn: '2026-01-01', reviewOn: today };
        // Reviewed "today" in Central: Expiring soon, as the SQL sweep sees it.
        const pairs = consentAlertPairs(reg);
        assert.ok(pairs.has('consent.expiring:c-media'), 'the live expiring row is not judged stale');
        assert.ok(!pairs.has('consent.missing:c-media'));
    } finally {
        if (saved === undefined) delete process.env.TZ;
        else process.env.TZ = saved;
    }
});
