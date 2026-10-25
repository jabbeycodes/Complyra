/**
 * Rule settings store: hosted (Supabase: effective_rules / set_rule_value) and
 * local demo implementations. The database enforces locks, types, ranges and
 * the no-backdating rule; the local store mirrors them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./index";
import {
  RULE_BY_KEY,
  resolveAllRules,
  resolveRule,
  validateRuleValue,
  type EffectiveRule,
  type RuleLock,
  type RuleValue,
  type RuleValueRow,
} from "./rules";

export interface SetRuleInput {
  agencyId: string;
  key: string;
  /** null = change only the lock. */
  value: RuleValue | null;
  reason: string;
  siteId?: string | null;
  /** ISO time the change takes effect (now or later). */
  effectiveFrom?: string;
  /** Operator only. */
  lock?: RuleLock | null;
}

export interface RulesStore {
  effectiveRules(agencyId: string, siteId?: string | null): Promise<EffectiveRule[]>;
  history(agencyId: string): Promise<RuleValueRow[]>;
  setRule(input: SetRuleInput): Promise<void>;
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function mapRow(row: Record<string, unknown>): RuleValueRow {
  return {
    id: String(row.id),
    agencyId: String(row.agency_id),
    siteId: (row.site_id as string | null) ?? null,
    key: String(row.key),
    value: (row.value as RuleValue | null) ?? null,
    lock: (row.lock as RuleLock | null) ?? null,
    effectiveFrom: String(row.effective_from),
    reason: String(row.reason ?? ""),
    setByName: String(row.set_by_name ?? ""),
    setAsOperator: Boolean(row.set_as_operator),
    createdAt: String(row.created_at),
  };
}

class SupabaseRulesStore implements RulesStore {
  constructor(private client: SupabaseClient) {}

  async effectiveRules(agencyId: string, siteId?: string | null): Promise<EffectiveRule[]> {
    const { data, error } = await this.client.rpc("effective_rules", {
      p_agency_id: agencyId,
      p_site_id: siteId ?? null,
    });
    fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      key: String(r.key),
      value: r.value as RuleValue,
      lock: r.lock as RuleLock,
      source: r.source as EffectiveRule["source"],
    }));
  }

  async history(agencyId: string): Promise<RuleValueRow[]> {
    const { data, error } = await this.client
      .from("rule_values")
      .select("*")
      .eq("agency_id", agencyId)
      .order("created_at", { ascending: false })
      .limit(500);
    fail(error);
    return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
  }

  async setRule(input: SetRuleInput): Promise<void> {
    const definition = RULE_BY_KEY.get(input.key);
    if (!definition) throw new Error("Unknown setting.");
    if (input.value !== null) {
      const problem = validateRuleValue(definition, input.value);
      if (problem) throw new Error(problem);
    }
    const { error } = await this.client.rpc("set_rule_value", {
      p_agency_id: input.agencyId,
      p_key: input.key,
      p_value: input.value,
      p_reason: input.reason,
      p_site_id: input.siteId ?? null,
      p_effective_from: input.effectiveFrom ?? new Date().toISOString(),
      p_lock: input.lock ?? null,
    });
    fail(error);
  }
}

/* ------------------------------ local demo ------------------------------ */

const LOCAL_KEY = "complyra.rules.v1";
const localMemory: { rows: RuleValueRow[] | null } = { rows: null };

export interface LocalRulesActor {
  userId: string;
  fullName: string;
  /** The Complyrer operator (platform owner). */
  isOperator: boolean;
  /** Agency the actor administers (null for non-admins). */
  adminOfAgencyId: string | null;
  /** Agencies the actor belongs to (for reads). */
  memberOfAgencyIds: string[];
}

export class LocalRulesStore implements RulesStore {
  constructor(private actor: LocalRulesActor, private now: () => Date = () => new Date()) {}

  private load(): RuleValueRow[] {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LOCAL_KEY) : null;
      if (raw) localMemory.rows = JSON.parse(raw) as RuleValueRow[];
    } catch {
      // Keep the in-memory copy.
    }
    localMemory.rows ??= [];
    return localMemory.rows;
  }

  private save(rows: RuleValueRow[]): void {
    localMemory.rows = rows;
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
    } catch {
      // Keep the in-memory copy.
    }
  }

  private canRead(agencyId: string): boolean {
    return this.actor.isOperator || this.actor.memberOfAgencyIds.includes(agencyId);
  }

  /** Synchronous read for the local demo (open-shift decisions can't await). */
  effectiveNow(agencyId: string, siteId?: string | null): EffectiveRule[] {
    if (!this.canRead(agencyId)) throw new Error("You can only read settings for your own agency.");
    return resolveAllRules(this.load(), agencyId, siteId, this.now());
  }

  async effectiveRules(agencyId: string, siteId?: string | null): Promise<EffectiveRule[]> {
    return this.effectiveNow(agencyId, siteId);
  }

  async history(agencyId: string): Promise<RuleValueRow[]> {
    if (!this.canRead(agencyId)) throw new Error("You can only read settings for your own agency.");
    return this.load()
      .filter((r) => r.agencyId === agencyId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setRule(input: SetRuleInput): Promise<void> {
    const definition = RULE_BY_KEY.get(input.key);
    if (!definition) throw new Error("Unknown setting.");
    const rows = this.load();
    if (!this.actor.isOperator) {
      if (this.actor.adminOfAgencyId !== input.agencyId) {
        throw new Error("Only the Complyrer operator or an agency administrator can change settings.");
      }
      if (resolveRule(rows, input.key, { agencyId: input.agencyId, at: this.now() }).lock !== "agency") {
        throw new Error("This setting is locked by Complyrer.");
      }
      if (input.lock) throw new Error("Only the Complyrer operator can lock or unlock settings.");
    }
    if (!input.reason.trim()) throw new Error("Add a reason for the change.");
    const now = this.now();
    const effective = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
    if (effective.getTime() < now.getTime() - 5 * 60_000) {
      throw new Error("Changes can't be backdated; they apply from now or a future time.");
    }
    if (input.siteId && !definition.siteAdjustable) {
      throw new Error("This setting applies to the whole agency, not one site.");
    }
    if (input.value === null && !input.lock) throw new Error("Nothing to change.");
    if (input.value !== null) {
      const problem = validateRuleValue(definition, input.value);
      if (problem) throw new Error(problem);
    }
    rows.push({
      id: `rv-${crypto.randomUUID().slice(0, 8)}`,
      agencyId: input.agencyId,
      siteId: input.siteId ?? null,
      key: input.key,
      value: input.value,
      lock: input.lock ?? null,
      effectiveFrom: new Date(Math.max(effective.getTime(), now.getTime())).toISOString(),
      reason: input.reason.trim(),
      setByName: this.actor.fullName,
      setAsOperator: this.actor.isOperator,
      createdAt: now.toISOString(),
    });
    this.save(rows);
  }
}

export function createRulesStore(actor: LocalRulesActor): RulesStore {
  const client = createSupabaseBrowserClient();
  if (client) return new SupabaseRulesStore(client);
  return new LocalRulesStore(actor);
}
