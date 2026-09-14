# Recognition scoring

Complyrer's weekly recognition is **winners only**: each agency names one
**House Manager of the Week** and one **DSP of the Week** every Sunday.
There are no public leaderboards, rankings, runner-ups, or scores — only the
two winners and their positive highlights are ever shared.

## When selection runs

- **Schedule:** every Sunday at **06:05 UTC**, after the weekly HM checklist
  scheduler (06:00 UTC). Edge function: `select-weekly-winners`.
- **Target week:** the most recent week whose Monday-4pm checklist deadline
  has passed — the Sunday run scores the week that ended **seven days
  earlier** (Monday-based weeks). A manual run accepts an explicit
  `weekStart` (Monday, `YYYY-MM-DD`); its default picks up any newer week
  once its deadline passes.
- **Idempotent:** reruns never duplicate winners or notifications; a winner
  is unique per agency, week, and category.

## Rating scale (1–5)

Both review directions use the same whole-number scale:

| Rating | Label         |
| ------ | ------------- |
| 1      | Needs support |
| 2      | Developing    |
| 3      | Solid         |
| 4      | Strong        |
| 5       | Exceptional   |

Ratings of 1 or 2 are treated as supportive signals for coaching, never as
public call-outs — they never appear in the celebration surface.

## House Manager of the Week — weights

| Signal                                   | Weight |
| ---------------------------------------- | ------ |
| Weekly checklists completed on time      | 35%    |
| Monthly checks completed on time         | 20%    |
| Site compliance standing                 | 25%    |
| Rolling DSP satisfaction (their ratings) | 20%    |

- **Weekly checklists on time** — share of assigned weekly checklists for the
  week submitted by the Monday-4pm deadline (checklist weeks are Sunday-keyed;
  the recognition week's checklist week is the Sunday just before the week).
- **Monthly checks on time** — share of monthly checks due in the week
  completed by deadline.
- **Site compliance standing** — current compliance percentage of the sites
  the HM manages.
- **DSP satisfaction** — rolling average of the 1–5 ratings their assigned
  DSPs have given them, mapped to 0–1 (`(avg − 1) / 4`).

## DSP of the Week — weights

| Signal                                   | Weight |
| ---------------------------------------- | ------ |
| Training and current credentials         | 30%    |
| Documentation timeliness                 | 25%    |
| Reliability / consistency                | 20%    |
| Their house manager's current review     | 25%    |

- **Training and credentials** — training-gate status and certificate
  currency (cleared to work alone = full credit).
- **Documentation timeliness** — share of assigned acknowledgment packets
  signed on time during the week.
- **Reliability** — attendance/consistency signals available in the
  scheduling data.
- **HM's current review** — the single current 1–5 HM→DSP review, mapped to
  0–1 (`(avg − 1) / 4`). A missing review is neutral, not a penalty.

## Missing data is neutral, never a penalty

Every signal that has no data for the week scores **half credit (0.5)** —
exactly halfway between a perfect and a zero signal. A new hire with no
history can still win on the strength of the signals that exist.

## Tie-breaking

1. Highest weighted total score wins.
2. Exact ties break by **candidate user ID** (deterministic, reproducible).

## What gets stored

| Table                            | Visibility                                  |
| -------------------------------- | ------------------------------------------- |
| `recognition_score_snapshots`    | Private. One row per candidate per week with the full score breakdown. Recognition managers only. |
| `recognition_winners`            | Public-safe. Winner identity + **positive highlights only** (e.g. "Weekly checklists completed on time"). No scores, no breakdowns, no candidate lists. |

Highlights are awarded per signal when that signal's weighted points reach at
least **80%** of the signal's maximum weight.

## Reviews (private, bidirectional)

- **DSP → HM:** one current rating per pair; append-only history of every
  change; the reviewed HM is notified of each real change (notifications
  dedupe on the individual change ID).
- **HM → DSP:** one current review per pair; same append-only history and
  notification rules.
- Re-submitting the same value is a no-op: no history row, no notification.
- Reviews stay private to the pair, appropriate managers, and
  administrators. The HM's current review contributes **25%** of the
  DSP-of-the-Week score.
- **"Appropriate managers":** administrators and compliance admins see the
  whole agency; other `recognition.manage` holders (DPMs, program managers,
  customized templates) see only reviews where they share an active site
  (membership or `staff_assignments`) with at least one party of the pair.
- Ratings and reviews can only be written between people assigned together
  (shared active site), enforced by `private.share_active_site`.

## Notifications

Each real review change notifies the reviewed person once (dedupe by change
ID). Each Sunday selection queues one personal celebration row for each
winner plus role-wide announcements (dedupe key per agency/week/category),
so reruns never double-notify.
