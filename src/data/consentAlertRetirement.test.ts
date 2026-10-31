/**
 * consentAlertRetirement.test.ts — simulation batch 24: consent alerts
 * never cleared after the underlying action. Recording/renewing a
 * consent must retire its outstanding alerts for every recipient, and
 * a consent carries exactly ONE current status: when "Expiring soon"
 * flips to "Expired", the expiring alert retires as the missing alert
 * arrives — never both at once.
 *
 * Run: node --import tsx --test src/data/consentAlertRetirement.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_CONSENT_TYPES,
    consentAlertPairs,
    consentOnFile,
    isStaleConsentNotification,
    type ConsentRegister,
} from './consents';
import { LocalApi, MemoryStore } from './localApi';
import { createEvergreenSeed } from './seed';
import { todayStamp } from './status';

function daysFromNow(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function localFixture() {
    const db = createEvergreenSeed();
    const store = new MemoryStore(db);
    const api = new LocalApi(store);
    const hm = db.memberships.find(m => m.roleKey === 'house_manager')!;
    store.sessionUserId = hm.userId;
    const person = db.individuals.find(p => p.siteId === hm.siteId)!;
    const draft = {
        individualId: person.id,
        typeId: 'media',
        covers: 'Taking and sharing photographs for the agency newsletter.',
        giver: 'guardian' as const,
        giverName: 'Sam Rivera',
        relationship: 'Parent and guardian',
        signedOn: todayStamp(),
        effectiveOn: todayStamp(),
        reviewOn: '2099-12-31',
        supersedesId: null,
    };
    return { db, store, api, hm, person, draft };
}

function consentRowsFor(db: ReturnType<typeof createEvergreenSeed>, entityId: string) {
    return (db.notifications ?? []).filter(
        n => n.type.startsWith('consent.') && n.entityId === entityId,
    );
}

test('recording a missing consent retires its alerts for every recipient', async () => {
    const f = localFixture();
    const missingEntity = `${f.person.id}:media`;
    await f.api.listNotifications();
    const before = consentRowsFor(f.db, missingEntity);
    assert.ok(before.length >= 2, 'HM direct + PM broadcast rows were queued');
    assert.ok(before.every(n => n.type === 'consent.missing'));

    // Record + activate the consent: the gap closes, so every stored
    // alert row for it retires — not just the acting manager's copy.
    const id = await f.api.saveConsent(f.draft);
    await f.api.activateConsent(id);
    await f.api.listNotifications();
    assert.deepEqual(consentRowsFor(f.db, missingEntity), []);
    // Unrelated gaps are untouched.
    assert.ok(
        (f.db.notifications ?? []).some(
            n => n.type === 'consent.missing' && n.entityId !== missingEntity,
        ),
        'other missing-consent alerts remain',
    );
});

test('expiring -> expired flip leaves exactly one current alert per consent', async () => {
    const f = localFixture();
    const id = await f.api.saveConsent({ ...f.draft, reviewOn: daysFromNow(10) });
    await f.api.activateConsent(id);

    await f.api.listNotifications();
    const expiring = consentRowsFor(f.db, id);
    assert.ok(expiring.length >= 2, 'expiring alerts queued for HM + PM');
    assert.ok(expiring.every(n => n.type === 'consent.expiring'));
    assert.deepEqual(consentRowsFor(f.db, `${f.person.id}:media`), []);

    // The review date passes: the chart status flips to Expired.
    const stored = f.db.consents!.find(r => r.id === id)!;
    stored.reviewOn = daysFromNow(-1);
    const register = await f.api.getConsents();
    assert.equal(consentOnFile(register, f.person.id, 'media').status, 'Expired');

    await f.api.listNotifications();
    const after = consentRowsFor(f.db, id);
    assert.ok(after.length >= 2, 'the missing alert is queued in its place');
    assert.ok(
        after.every(n => n.type === 'consent.missing'),
        'only the missing alert remains — never Missing AND Expiring soon together',
    );
});

test('renewing an expiring consent retires its expiring alerts', async () => {
    const f = localFixture();
    const id = await f.api.saveConsent({ ...f.draft, reviewOn: daysFromNow(5) });
    await f.api.activateConsent(id);
    await f.api.listNotifications();
    assert.ok(consentRowsFor(f.db, id).some(n => n.type === 'consent.expiring'));

    const renewal = await f.api.saveConsent({ ...f.draft, supersedesId: id });
    await f.api.activateConsent(renewal);
    await f.api.listNotifications();
    assert.deepEqual(consentRowsFor(f.db, id), []);
    assert.deepEqual(consentRowsFor(f.db, renewal), []);
});

test('pure pairs: one live pair per gap; staleness matrix', () => {
    const register: ConsentRegister = {
        types: DEFAULT_CONSENT_TYPES,
        records: [
            {
                individualId: 'i1',
                typeId: 'media',
                covers: 'Photos.',
                giver: 'guardian',
                giverName: 'Sam Rivera',
                relationship: 'Parent',
                signedOn: '2026-10-01',
                effectiveOn: '2026-10-01',
                reviewOn: '2026-11-05',
                supersedesId: null,
                id: 'c-active-soon',
                agencyId: 'a1',
                createdBy: 'hm',
                createdAt: '2026-10-01T10:00:00Z',
                activatedAt: '2026-10-01T11:00:00Z',
                activatedBy: 'hm',
            },
        ],
        revocations: [],
        individuals: [{ id: 'i1', agencyId: 'a1', siteId: 's1', fullName: 'Taylor' }],
    };
    const pairs = consentAlertPairs(register, '2026-10-27');
    // The media consent is "Expiring soon" (review 2026-11-05): ONE pair.
    assert.ok(pairs.has('consent.expiring:c-active-soon'));
    assert.ok(!pairs.has('consent.missing:c-active-soon'));
    assert.ok(!pairs.has('consent.missing:i1:media'));
    // Another required type with no record at all: missing pair, keyed person:type.
    assert.ok([...pairs].some(p => p.startsWith('consent.missing:i1:')));

    const noPackets = new Set<string>();
    assert.equal(
        isStaleConsentNotification({ type: 'consent.missing', entityId: 'c-active-soon' }, pairs, noPackets),
        true,
        'a missing row for an expiring consent is stale',
    );
    assert.equal(
        isStaleConsentNotification({ type: 'consent.expiring', entityId: 'c-active-soon' }, pairs, noPackets),
        false,
    );
    assert.equal(
        isStaleConsentNotification({ type: 'consent.packet_outstanding', entityId: 'p1' }, pairs, noPackets),
        true,
    );
    assert.equal(
        isStaleConsentNotification({ type: 'consent.packet_outstanding', entityId: 'p1' }, pairs, new Set(['p1'])),
        false,
    );
    assert.equal(
        isStaleConsentNotification({ type: 'consent.packet_signed', entityId: 'p1' }, pairs, noPackets),
        false,
        'event rows are history, never stale',
    );
    assert.equal(
        isStaleConsentNotification(
            { type: 'consent.missing', entityId: 'rights-entity-1', entityType: 'rights_packet' },
            pairs,
            noPackets,
        ),
        false,
        'rights-packet alerts reuse the consent types but track packets, not gaps',
    );
    assert.equal(
        isStaleConsentNotification(
            { type: 'consent.missing', entityId: 'c-active-soon', entityType: 'consent' },
            pairs,
            noPackets,
        ),
        true,
        'the consent register’s own rows are judged by the gap pairs',
    );
});
