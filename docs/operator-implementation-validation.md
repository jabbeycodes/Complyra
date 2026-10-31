# Operator phases 1–9: validation and deployment boundary

The audit document and PR #176 were not changed. All nine implementation PRs are drafts. They form a dependency stack: phase 1 targets main; each subsequent phase targets the preceding phase because it extends that phase's console/data workflow. Merge in order and retarget as appropriate after the preceding branch merges.

| Phase | Draft PR | Full npm test result | Build / TypeScript | Phase pgTAP assertions |
| --- | --- | --- | --- | --- |
| 1 | [#180](https://github.com/jabbeycodes/Complyra/pull/180) | 152 entries, pass | pass / pass | 7 pass |
| 2 | [#181](https://github.com/jabbeycodes/Complyra/pull/181) | 153 entries, pass | pass / pass | 3 pass |
| 3 | [#182](https://github.com/jabbeycodes/Complyra/pull/182) | 154 entries, pass | pass / pass | 6 pass |
| 4 | [#183](https://github.com/jabbeycodes/Complyra/pull/183) | 155 entries, pass | pass / pass | 4 pass |
| 5 | [#184](https://github.com/jabbeycodes/Complyra/pull/184) | 156 entries, pass (rerun after SQL fix) | pass / pass | 5 pass |
| 6 | [#185](https://github.com/jabbeycodes/Complyra/pull/185) | 157 entries, pass | pass / pass | 4 pass |
| 7 | [#187](https://github.com/jabbeycodes/Complyra/pull/187) | 158 entries, pass | pass / pass | 3 pass |
| 8 | [#190](https://github.com/jabbeycodes/Complyra/pull/190) | 160 entries, pass | pass / pass | 8 pass |
| 9 | See this PR | 161 entries, pass | pass / pass | 13 + 88 cross-phase role boundaries pass |

Commands: `npm test`, `npm run build`, `npx tsc -b`, `git diff --check`. Build retains the existing large-bundle warning. Tests are the runner's file-level entries; no unit failures were accepted.

Final browser regression used system Chromium with a local Vite server and the existing fixed-clock fixture. `operator-console.spec.ts` and `ai-settings-operator.spec.ts` passed seven tests: tenant admin denial, canonical AI settings/no duplicate embed, source-backed registration drill-down and Back/filter persistence, bounded audit CSV export, read-only people/support context, unknown local health and versioned templates preserving original notice context. Earlier phase checkpoints ran the applicable subset. Browser testing uses LocalApi, not a deployed Supabase project.

Final SQL verification used a fresh isolated PostgreSQL 15 container with pgTAP and minimal Supabase Auth/Storage scaffolding (JWT claim helper functions, Auth users table and private Storage tables/functions). Every repository migration was executed in filename order, with a transaction per file. All new `operator_*.sql` tests passed 141 assertions. Existing `access_boundaries.sql`, `document_pipeline_scope.sql`, `rule_settings.sql`, `system_notices.sql` and `operating_notices.sql` passed another 62 assertions: **203 pass, zero fail**. The tests exercise all eight tenant templates against eleven operator read/action boundaries, including agency administrator. This validates SQL authorization and behavior, not deployed gateway/JWT configuration or provider credentials.

The database run exposed an existing care-pipeline trigger rejecting upload-free AI metadata events from an operator outside tenant membership. Phase 5 includes the narrow 20261031050100 migration repair; the fix was merged forward into dependent branches. Clinical record/site/individual checks were preserved and the existing document-scope tests passed.

Five modified Edge Function entry points (reminder sweep, delegation sweep, weekly checklists, weekly winners and extraction verification) passed esbuild TypeScript syntax transformation. Worker-observer unit tests cover success, failure, exceptions and unavailable telemetry. Live scheduled execution, provider/network behavior, production telemetry and deployment were not tested or claimed.

No migration has been deployed to a hosted project by this task. Deploy migrations in order before enabling the matching client, then redeploy affected Edge Functions. The local test container is disposable and contains fictional test fixtures only. No billing/subscription/trial/customer-retention data or features were added.

Local demo: use the existing platform operator account `COMPLYRER-MO` / `platform.owner` with the existing demo password constant in `src/data/types.ts`. The directory and overview include the seeded `EVERGREEN-MO` agency, explicitly classified as demo; select the demo reporting group to inspect it. The Evergreen agency administrator remains a non-operator. Tenant authorization is not relaxed to expose operator screens.

Out-of-scope unlocks: Phase 10 needs an agreed billing source and approved commercial schema/entitlements; Phase 11 needs that foundation, authorized provider access and reconciled revenue definitions; Phase 12 needs validated retention/cohort instrumentation plus separate approval for support-case, operator-privilege and security administration.
