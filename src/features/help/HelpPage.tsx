/**
 * Help & resources — the real help center for Complyrer.
 *
 * How-to guidance for the key features (training checklists, signing,
 * delegations, mileage, weekly checklists, certificates, documents), an FAQ,
 * and where to get support. Plain Complyrer wording; English only.
 */
import { PageHeading } from "../../components";
import "./help.css";

const SECTIONS: {
  id: string;
  title: string;
  points: string[];
}[] = [
  {
    id: "training",
    title: "Training checklists",
    points: [
      "Open Training from the sidebar, then choose Assign training. Pick a staff member and a site — the Generate checklist button unlocks only when both are chosen.",
      "Generating builds the full in-home checklist for that staffer: sections 1–5 for the site, section 6 for an individual if you pick one. Lines that already exist are skipped, never duplicated.",
      "Staff initial each line (or mark it N/A with a reason) using their adopted e-signature. Adopt it once under your profile — after that, initialing is one tap.",
      "When every line is done, the house manager countersigns the sheet. After countersign, the sheet locks; changes need a correction request.",
      "The in-ratio gate: 20 hours of training with 8 hours alongside the house manager before working alone. Anyone short of the gate appears under “Not cleared to work alone”.",
    ],
  },
  {
    id: "signing",
    title: "Signing",
    points: [
      "Adopt your electronic signature once: draw or type it, then confirm. Every later stamp reuses the adoption — signatures are never typed per line.",
      "Per-line initials stamp the exact version of that line. Editing a signed line voids the old stamp and asks you to re-initial; the old version stays in history.",
      "Sign & submit buttons (checklists, acknowledgments) lock the document. A locked document can only be changed through a correction request, which is written to the audit trail.",
    ],
  },
  {
    id: "delegations",
    title: "Delegations",
    points: [
      "Delegations holds the agency-wide template library (nursing and care tasks, in Complyrer's own wording).",
      "A degreed professional manager activates a template for a program site, drafts the training material, and a nurse or DPM reviews and approves it.",
      "Approved delegations go to site staff, who review and sign acknowledgment. Signed vs. unsigned staff are tracked on the delegation.",
    ],
  },
  {
    id: "weekly",
    title: "Weekly checklists",
    points: [
      "House managers answer every item each week — no blanks — and add service-log entries for second-page notes.",
      "Submit by Monday at 4:00 p.m. Late submissions stay flagged as late on the record.",
      "The checklist auto-renews every Sunday: prior open weeks lock as overdue and a fresh blank checklist opens for the new week. Nothing carries over — each week starts clean.",
      "DPMs and administrators assign checklists and watch every home's status on Checklist assignments.",
    ],
  },
  {
    id: "mileage",
    title: "Mileage",
    points: [
      "Log each work trip with the date, purpose, and miles. Mileage keeps a running total per period for reimbursement records.",
      "Export or print the log when you need it for payroll or the audit file.",
    ],
  },
  {
    id: "certificates",
    title: "Certificates",
    points: [
      "HR uploads staff certificates (CPR, first aid, medication aide, and others) or enters their dates manually.",
      "Each certificate shows a days-remaining countdown to renewal so nothing lapses unnoticed. Everything appears on the staff profile.",
    ],
  },
  {
    id: "documents",
    title: "Documents & review",
    points: [
      "Upload documents under Documents. Drafts stay in the review queue until an authorized reviewer approves them — only approved records count as active.",
      "Acknowledgment packets collect staff signatures in one place; chase the unsigned rows before the deadline.",
      "The Activity log records who did what and when: assignments, signings, approvals, and corrections.",
    ],
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Why is a button disabled?",
    a: "Buttons stay disabled until their requirements are met — usually a missing selection (pick a staff member and a site first) or a submission already in progress. Fill the required fields and it unlocks.",
  },
  {
    q: "What does “Not cleared to work alone” mean?",
    a: "The staffer has not met the in-ratio gate yet: 20 hours of training including 8 hours alongside the house manager, with every checklist line initialed or marked N/A and the sheet countersigned. Open their profile to see exactly what is missing.",
  },
  {
    q: "I signed the wrong thing. Can it be fixed?",
    a: "Yes. Request a correction with a reason — the sheet unlocks, you edit it, and the staffer and house manager sign again. The reason and every version are kept in the audit trail.",
  },
  {
    q: "Where do I see what changed recently?",
    a: "The Activity log lists assignments, signings, approvals, and corrections across the agency, newest first.",
  },
  {
    q: "Is this the live system or a demo?",
    a: "If you see the “Interactive preview” banner, you are in a fictional demonstration workspace — do not enter real care or employee records there. In a hosted workspace your agency's records are isolated and access is limited by role.",
  },
  {
    q: "Who do I contact for help?",
    a: "Your agency administrator handles accounts, roles, and access. For how-to questions, use the Records lookup assistant in the sidebar or work through the guides above.",
  },
];

export default function HelpPage() {
  return (
    <div data-tour="help">
      <PageHeading title="Help" />
      <nav className="help-toc panel" aria-label="Help topics">
        <h2>Guides</h2>
        <ul>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#help-${section.id}`}>{section.title}</a>
            </li>
          ))}
          <li>
            <a href="#help-faq">Frequently asked questions</a>
          </li>
          <li>
            <a href="#help-support">Where to get support</a>
          </li>
        </ul>
      </nav>
      {SECTIONS.map((section) => (
        <section
          key={section.id}
          id={`help-${section.id}`}
          className="panel"
          aria-label={section.title}
        >
          <h2>{section.title}</h2>
          <ul className="help-list">
            {section.points.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </section>
      ))}
      <section id="help-faq" className="panel" aria-label="Frequently asked questions">
        <h2>Frequently asked questions</h2>
        {FAQS.map((faq, i) => (
          <details key={i} className="help-faq">
            <summary>{faq.q}</summary>
            <p>{faq.a}</p>
          </details>
        ))}
      </section>
      <section id="help-support" className="panel" aria-label="Where to get support">
        <h2>Where to get support</h2>
        <ul className="help-list">
          <li>
            <strong>Your agency administrator</strong> — accounts, passwords,
            roles, and access. They can also assign training and checklists.
          </li>
          <li>
            <strong>Records lookup</strong> — the assistant card in the sidebar
            finds answers inside your agency's compliance records.
          </li>
          <li>
            <strong>Something broken?</strong> — note what you clicked, what you
            expected, and what happened, then send it to your agency
            administrator with the time it occurred.
          </li>
        </ul>
      </section>
    </div>
  );
}
