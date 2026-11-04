import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import { PACKET_ITEMS, type PacketChoices, type PacketSignature } from "./consentPackets";
import { centralTodayIso } from "./menuRecords";
import { todayStamp } from "./status";

/**
 * Wave 1 audit: the local workspace saved signed packet PDFs as base64
 * inside its one localStorage meta entry, so signing a packet blew the
 * browser quota and failed. The bytes now go to the file store; the meta
 * keeps only the evidence name/mime. This pins both halves with a
 * quota-limited localStorage stand-in.
 */
const QUOTA_CHARS = 2_000_000;

function installQuotaLocalStorage() {
  const items = new Map<string, string>();
  const used = () => [...items.values()].reduce((sum, value) => sum + value.length, 0);
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const next = used() - (items.get(key)?.length ?? 0) + value.length;
      if (next > QUOTA_CHARS) {
        throw new Error(`Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`);
      }
      items.set(key, value);
    },
    removeItem: (key: string) => void items.delete(key),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
  };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  return { items, restore: () => delete (globalThis as { localStorage?: unknown }).localStorage };
}

// Same answers the consentPackets tests use (media / photograph take their
// own option sets).
const choices: PacketChoices = Object.fromEntries(
  PACKET_ITEMS.map((item) => [item.key, item.key === "media" ? "group" : item.key === "photograph" ? "no" : "yes"]),
);
const signer: PacketSignature = {
  printedName: "Jordan Lee",
  signature: "Jordan Lee",
  authority: "Guardian",
  authorityOther: "",
  witness: "Taylor Witness",
  signedOn: todayStamp(),
  accepted: true,
};

test("signing several consent packets never puts PDF bytes in the localStorage meta", async () => {
  const quota = installQuotaLocalStorage();
  try {
    const db = createEvergreenSeed();
    const store = new MemoryStore(db);
    const api = new LocalApi(store);
    const hm = db.memberships.find((m) => m.roleKey === "house_manager")!;
    const person = db.individuals.find((p) => p.siteId === hm.siteId)!;
    const input = {
      individualId: person.id,
      signerName: "Jordan Lee",
      effectiveOn: centralTodayIso(),
      reviewOn: "2099-12-31",
      outstandingAfterDays: 1,
    };
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      store.sessionUserId = hm.userId;
      const id = await api.createConsentPacket(input);
      await api.generateConsentPacket(id);
      const token = await api.sendConsentPacket(id, 7);
      store.sessionUserId = null;
      const evidence = await api.signConsentPacket(token, choices, signer);
      assert.ok(atob(evidence.base64).startsWith("%PDF-"), "the signer gets the PDF back");
      ids.push(id);
    }
    const meta = quota.items.get("complyra-v2-meta") ?? "";
    assert.ok(meta.length > 0, "the meta entry was written");
    assert.ok(!meta.includes("JVBERi0"), "no base64 PDF (\"%PDF-\") inside the meta");

    // After a reload the meta's evidence has no bytes; the getter reads them
    // back from the file store.
    for (const id of ids) db.consentPacketEvidence![id].base64 = "";
    store.sessionUserId = hm.userId;
    const reread = await api.getConsentPacketEvidence(ids[0]);
    assert.ok(atob(reread.base64).startsWith("%PDF-"), "evidence reads back from the file store");
  } finally {
    quota.restore();
  }
});
