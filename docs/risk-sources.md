# Risk & deadline sources

`src/data/riskSources.ts` is the pluggable interface any feature uses to
contribute **risks** (things that need management attention) and **deadlines**
(date-bound obligations) to dashboards, summaries, and the audit-readiness
surface. It is intentionally decoupled from any single feature's tables.

## Concepts

- A **source** is a named, synchronous, pure function:
  `(ctx: RiskSourceContext) => RiskItem[]` or `(ctx) => DeadlineItem[]`.
- **Registration** is by name and idempotent — registering the same name
  twice replaces the previous function. Importing the module registers the
  built-in sources (currently `pcsp-extraction`).
- **Collection** merges every registered source: `collectRisks(ctx)` sorts
  high → medium → low severity, then by due date; `collectDeadlines(ctx)`
  sorts soonest first. A throwing source is skipped so one broken source
  cannot take down a dashboard.

## Interfaces

```ts
interface RiskItem {
  id: string;            // stable, unique per source+entity: "<source>:<kind>:<entityId>"
  source: string;        // source name, e.g. "pcsp-extraction"
  severity: "high" | "medium" | "low";
  title: string;         // human-readable, names the person/entity
  detail: string;        // one or two plain sentences: what + why it matters
  siteId?: string;
  dueDate?: string;      // ISO date, when known
}

interface DeadlineItem {
  id: string;
  source: string;
  title: string;
  dueDate: string;       // ISO date (YYYY-MM-DD)
  siteId?: string;
  individualId?: string;
}

interface RiskSourceContext {
  extractions?: PcspExtraction[];  // approved PCSP extractions (documents feature)
  now?: number;                    // overrideable clock, defaults to Date.now()
  // Future sources add their own optional fields here.
}
```

## Registering a new source

```ts
import { registerRiskSource, registerDeadlineSource } from "./riskSources";

registerRiskSource("certificates", (ctx) => {
  // translate already-loaded domain data into RiskItems
  return [...];
});

registerDeadlineSource("certificates", (ctx) => {
  return [...];
});
```

Rules:

1. **Pure translation only.** Sources never fetch. The caller loads domain
   data and passes it in the context.
2. **Stable ids.** `id` must be deterministic per source+entity so consumers
   can dedupe across renders.
3. **Human-readable text.** Titles name the person or site; details say what
   is wrong and why it matters. No codes, no jargon.
4. **No PHI beyond what the consumer already shows.** Sources reuse data the
   caller already loaded; they don't widen access.

## The `pcsp-extraction` source

Registered by this module from approved PCSP extractions
(`PcspExtraction`, see `src/features/documents/documents.ts`).

Only **approved** extractions contribute — nothing is actionable before a
DPM/RN approves the extraction.

| Kind | Severity | Rule |
| ---- | -------- | ---- |
| Deadline | — | Plan end date → "PCSP plan expires — {name}" |
| Deadline | — | Annual review date → "Annual plan review due — {name}" (skipped when identical to plan end) |
| Risk | high | Each missing signature → "Missing signature: {role} — {name}" |
| Risk | medium | Each **unactivated, high-confidence** trackable item → "Not yet activated: {title}". High-confidence = confidence score ≥ 0.7 or no score reported. |

The pure mappers `pcspExtractionDeadlines(extraction)` and
`pcspExtractionRisks(extraction, now)` are exported for tests and for
consumers that want per-extraction results without the registry.

## Consuming

```ts
import { collectRisks, collectDeadlines } from "./riskSources";

const risks = collectRisks({ extractions });
const deadlines = collectDeadlines({ extractions });
```

Render severity with icon + text + color (never color alone), per the
app's accessibility rules.
