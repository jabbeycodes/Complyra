import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "marketing");

const mark = `<svg class="brand-mark" aria-hidden="true" viewBox="0 0 120 120" fill="none">
          <g stroke-linecap="round" stroke-linejoin="round">
            <path d="M103.3 35 60 10 16.7 35 16.7 85 60 110 103.3 85" stroke="#3f5c3b" stroke-width="16"/>
            <path d="M60 10 103.3 35" stroke="#6f815c" stroke-width="16"/>
            <path d="M60 110 103.3 85" stroke="#2f4630" stroke-width="16"/>
            <path d="M42 58l10 11 22-26" stroke="#8b5e3c" stroke-width="11"/>
          </g>
        </svg>`;

function page({ path, title, description, heading, current, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#234238" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="canonical" href="https://complyrer.com${path}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/legal.css" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
</head>
<body>
  <a class="skip" href="#main">Skip to main content</a>
  <header class="nav">
    <div class="wrap nav-inner">
      <a class="brand" href="/" aria-label="ComplyRer home">
        ${mark}
        <span class="brand-copy"><span class="brand-word"><span class="brand-word-main">Comply</span><span class="brand-word-tail">Rer</span></span><span class="brand-tagline">Go paperless. Stay audit-ready.</span></span>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links" aria-label="Open navigation">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <nav class="nav-links" id="nav-links" aria-label="Primary navigation">
        <a href="/site#readiness">Audit readiness</a>
        <a href="/site#paperless">How it works</a>
        <a href="/site#missouri">Missouri DMH</a>
        <a href="${path}" aria-current="page">${current}</a>
        <a href="https://secure.complyrer.com">Sign in</a>
      </nav>
      <a class="nav-action" href="/site#contact">Book a demo</a>
    </div>
  </header>
  <main id="main" class="legal">
    <article class="legal-card">
      <p class="kicker">ComplyRer</p>
      <h1>${heading}</h1>
      <p class="updated">Effective September 14, 2026 · Last updated September 14, 2026</p>
      ${body}
    </article>
  </main>
  <footer class="footer">
    <div class="wrap">
      <div class="footer-grid">
        <div class="footer-copy">
          <a class="brand footer-brand" href="/" aria-label="ComplyRer home">
            ${mark}
            <span class="brand-copy"><span class="brand-word"><span class="brand-word-main">Comply</span><span class="brand-word-tail">Rer</span></span><span class="brand-tagline">Go paperless. Stay audit-ready.</span></span>
          </a>
          <p>Compliance visibility, paperless workflows, and audit readiness for care providers.</p>
        </div>
        <nav class="footer-links" aria-label="Footer navigation">
          <a href="/site#readiness">Audit readiness</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/security">Security</a>
          <a href="https://secure.complyrer.com">Sign in</a>
          <a href="/site#contact">Book a demo</a>
        </nav>
      </div>
      <div class="footer-bottom">
        <span>© 2026 ComplyRer</span>
        <nav aria-label="Legal"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/security">Security</a></nav>
      </div>
    </div>
  </footer>
  <script>
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('#nav-links');
    navToggle.addEventListener('click', () => {
      const open = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!open));
      navToggle.setAttribute('aria-label', open ? 'Open navigation' : 'Close navigation');
      navLinks.classList.toggle('open', !open);
    });
  </script>
</body>
</html>
`;
}

const pages = [
  {
    file: "privacy/index.html",
    path: "/privacy",
    current: "Privacy",
    title: "Privacy Policy — ComplyRer",
    heading: "Privacy Policy",
    description:
      "How ComplyRer collects, uses, and protects personal information for the marketing site and the hosted compliance workspace.",
    body: `
      <p>This policy describes how ComplyRer (“we”, “us”) handles information on <a href="https://complyrer.com">complyrer.com</a> and in the hosted product at <a href="https://secure.complyrer.com">secure.complyrer.com</a>. It is written for developmental-disabilities and other care providers that may later store workforce and program records in the product.</p>
      <p>We do not sell personal information. We do not use marketing-site demo requests to train public models. We do not claim HIPAA compliance, HITRUST, SOC 2, or similar certifications on the strength of this page.</p>

      <h2>Who we are</h2>
      <p>ComplyRer is a software service that helps care agencies see requirements, deadlines, missing records, and evidence. The agency remains the operator of its compliance program. ComplyRer is a tool, not a regulator, surveyor, or legal advisor.</p>
      <p>Privacy questions: <a href="mailto:privacy@complyrer.com">privacy@complyrer.com</a>. General contact: <a href="mailto:hello@complyrer.com">hello@complyrer.com</a>.</p>

      <h2>Whose information this covers</h2>
      <ul>
        <li><strong>Website visitors</strong> who browse this marketing site or submit a demo request.</li>
        <li><strong>Agency users</strong> invited into a hosted workspace (administrators, managers, nurses, DSPs, and similar roles).</li>
        <li><strong>Individuals served by an agency</strong> only if that agency chooses to enter program records after the contractual and security gates below are met. Do not enter real individual, patient, or employee data into a demo or unverified environment.</li>
      </ul>

      <h2>Information we collect</h2>
      <p><strong>Demo requests.</strong> Name, work email, agency name, the workflow you want to review, and the time of the request. Optional fields you type in the form. We use a hidden honeypot field to ignore obvious spam.</p>
      <p><strong>Accounts and workspace data.</strong> When an agency is set up, we store provider codes, usernames, role memberships, site assignments, and the operational records the agency enters (plans, training, delegations, acknowledgments, certificates, and related evidence metadata). Hosted file uploads are stored in a private bucket scoped to the agency.</p>
      <p><strong>Technical logs.</strong> IP address, user agent, timestamps, and request identifiers needed to operate TLS, stop abuse, and debug failures. We aim to keep document contents and secrets out of application logs.</p>
      <p><strong>Cookies.</strong> The marketing pages do not set advertising cookies. The product uses cookies or local storage only as needed to keep a signed-in session and remember UI state such as a dismissed demo tour.</p>

      <h2>Health information and HIPAA</h2>
      <p>Care agencies are typically the covered entity or business associate for records about the people they support. ComplyRer processes agency-entered records only as a service provider. We will not treat the product as a HIPAA environment until a Business Associate Agreement (or equivalent), the technical safeguards on the <a href="/security">Security</a> page, and the agency’s own operating procedures are in place.</p>
      <p>Until those agreements exist, treat hosted workspaces as operational software with access controls—not as a declared HIPAA-compliant system of record. Interactive demos use fictional Evergreen Care data.</p>

      <h2>How we use information</h2>
      <ul>
        <li>Respond to demo requests and schedule a walkthrough of one workflow.</li>
        <li>Create and operate the agency workspace the customer asked for, including authentication, role-based access, and audit-ready exports the agency generates.</li>
        <li>Secure the service, prevent abuse, and investigate incidents.</li>
        <li>Meet legal obligations and enforce the <a href="/terms">Terms</a>.</li>
      </ul>
      <p>We do not use customer workspace contents for advertising. We do not share those contents with other agencies.</p>

      <h2>Legal bases (where GDPR or similar law applies)</h2>
      <p>Contract (providing the service an agency requested), legitimate interests (securing the site, answering a demo form), and legal obligation. Where we need consent, we will ask for it in product rather than bury it here.</p>

      <h2>Sharing and subprocessors</h2>
      <p>We share information only with processors that help us run the service, and only as needed:</p>
      <ul>
        <li><strong>Vercel</strong> — hosts the marketing site and the web application.</li>
        <li><strong>Supabase</strong> — authentication, Postgres with row-level security, and private file storage for hosted workspaces.</li>
      </ul>
      <p>We may disclose information if required by law, to protect a person from serious harm, or to defend a legal claim. We do not sell personal information or share it for cross-context behavioral advertising.</p>

      <h2>Retention</h2>
      <p>Demo requests are kept long enough to schedule and follow up, then deleted or minimized. Agency workspace data is retained while the agency’s account is active and for a limited period afterward so the agency can export records, unless a shorter deletion is required by the contract or by law. Agencies should tell us if a legal hold applies.</p>

      <h2>Security</h2>
      <p>Transport is encrypted (HTTPS). Hosted databases use deny-by-default row-level security and agency scoping. Uploaded source files are stored privately, not in a public bucket. Privileged product actions are written to an append-only audit log. Details and customer responsibilities are on the <a href="/security">Security</a> page.</p>

      <h2>Your rights</h2>
      <p>You may request access, correction, or deletion of personal information we hold about you, or ask us to close an account. Agency administrators control workforce accounts inside their tenant. For App Store / Play users, account deletion is requested through the agency administrator or by emailing <a href="mailto:privacy@complyrer.com">privacy@complyrer.com</a>. We will need enough information to verify the request and will not delete records an agency is legally required to keep unless the agency directs us to do so.</p>
      <p>You may also lodge a complaint with your data protection authority. U.S. state privacy rights (access, deletion, opt-out of sale—we do not sell) can be exercised at the same email.</p>

      <h2>Children</h2>
      <p>The marketing site and product are for adult workforce users at care agencies. We do not knowingly collect information directly from children. Individual records about people an agency supports are entered only by that agency in its role as provider.</p>

      <h2>International transfers</h2>
      <p>Infrastructure is operated in the United States. If you access the service from elsewhere, your information is processed in the U.S. under this policy and the Terms.</p>

      <h2>Changes</h2>
      <p>If we make a material change, we will update this page and the “Last updated” date. Material product changes that affect an agency’s data will also be communicated in-app or by email to the agency administrator where we have a working address.</p>
    `,
  },
  {
    file: "terms/index.html",
    path: "/terms",
    current: "Terms",
    title: "Terms of Service — ComplyRer",
    heading: "Terms of Service",
    description:
      "Terms for using the ComplyRer marketing site, demo, and hosted compliance workspace.",
    body: `
      <p>These Terms govern use of ComplyRer websites, demos, and the hosted application. By submitting a demo request, creating an agency, or signing in, you agree to them. If you are using ComplyRer for an organization, you confirm you have authority to bind that organization.</p>

      <h2>The service</h2>
      <p>ComplyRer is software for tracking requirements, assignments, evidence, training, delegations, and related operational records. It is a workflow and visibility tool. It is <strong>not</strong> legal advice, surveyor guidance, a substitute for an agency’s qualified staff, or a guarantee that an agency will pass a Missouri DMH, CMS, or other review.</p>
      <p>Readiness scores and “needs attention” views reflect what has been recorded in the workspace. They are not an automated determination of regulatory compliance. Agencies remain responsible for clinical, personnel, and certification decisions, including obligations under 9 CSR 45-5.060 and any other rules that apply to them.</p>

      <h2>Accounts</h2>
      <p>Each agency is a separate tenant. Users sign in with a provider code, username, and password. The agency administrator is responsible for inviting the right people, assigning roles and sites, and promptly disabling access when staff leave. Do not share passwords. Temporary passwords issued at agency setup must be changed at first sign-in.</p>
      <p>New agencies may be held in a pending state until ComplyRer activates them. We may refuse or suspend a workspace that appears to contain real protected records before the security and contractual gates on the <a href="/security">Security</a> page are met.</p>

      <h2>Customer data</h2>
      <p>The agency owns the records it enters. ComplyRer processes that data only to provide the service, as described in the <a href="/privacy">Privacy Policy</a>. You represent that you have the right to enter the data you upload, including staff and—when permitted—individual program records, and that you will not upload malware or content you do not have rights to.</p>
      <p><strong>Do not enter real individual, patient, or employee data</strong> into a demo, local preview, or any environment that has not been reviewed for authentication, tenant isolation, private storage, and audit logging.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No attempting to access another agency’s tenant, bypass role or site scope, or probe the service except through an agreed security test.</li>
        <li>No using the service to send spam, to store illegal content, or to interfere with other customers.</li>
        <li>No scraping the marketing site or product in a way that degrades the service.</li>
        <li>No representing ComplyRer scores or exports as a state certification or as HIPAA compliance.</li>
      </ul>

      <h2>Demos and marketing site</h2>
      <p>Illustrative dashboards on the marketing site use realistic but fictional figures. Submitting the demo form asks us to contact you; it does not create a paid subscription or an agency tenant. The interactive product demo uses fictional Evergreen Care data.</p>

      <h2>Fees</h2>
      <p>Paid plans, if offered, will be described in an order form or invoice. Unless that document says otherwise, fees are non-refundable for the period purchased. We may change unpublished list pricing; existing contracts control until they expire.</p>

      <h2>Intellectual property</h2>
      <p>ComplyRer and its marks, software, and documentation remain ours. You keep ownership of your records and source documents. You grant us a limited license to host, display, and process that material solely to provide the service to you.</p>

      <h2>Warranties and disclaimers</h2>
      <p>THE SERVICE IS PROVIDED “AS IS.” TO THE EXTENT PERMITTED BY LAW WE DISCLAIM IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We do not warrant uninterrupted service or that use of ComplyRer will satisfy a particular survey, plan of correction, or certification timeline.</p>

      <h2>Limitation of liability</h2>
      <p>To the extent permitted by law, ComplyRer is not liable for lost profits, lost records that the agency failed to export, survey findings, civil monetary penalties, or indirect or consequential damages. Our aggregate liability for a claim arising out of the service is limited to the amounts the agency paid us for the service in the twelve months before the claim, or one hundred U.S. dollars if the agency has paid nothing.</p>

      <h2>Indemnity</h2>
      <p>You will defend and indemnify ComplyRer against claims arising from your content, your misuse of the service, or your failure to obtain required consents or agreements (including a BAA) before placing protected health information in the workspace.</p>

      <h2>Termination</h2>
      <p>You may stop using the service at any time. We may suspend or close a workspace for non-payment, material breach, suspected abuse, or risk to other customers. After termination we will make customer data available for export for a limited period, then delete or de-identify it as described in the Privacy Policy, unless a legal hold requires otherwise.</p>

      <h2>Governing law</h2>
      <p>These Terms are governed by the laws of the State of Missouri, excluding conflict-of-law rules. Courts located in Missouri have exclusive jurisdiction, except that we may seek injunctive relief anywhere to protect the service or our IP.</p>

      <h2>Changes</h2>
      <p>We may update these Terms. Continued use after the “Last updated” date constitutes acceptance of the revised Terms for subsequent use. Material changes to a paid contract will be handled in that contract.</p>

      <h2>Contact</h2>
      <p><a href="mailto:hello@complyrer.com">hello@complyrer.com</a></p>
    `,
  },
  {
    file: "security/index.html",
    path: "/security",
    current: "Security",
    title: "Security — ComplyRer",
    heading: "Security",
    description:
      "How ComplyRer protects agency workspaces today, what we do not claim, and what agencies remain responsible for.",
    body: `
      <p>ComplyRer is built for care-agency operations: tenant isolation, role-aware access, private document storage, and an audit trail of privileged actions. This page describes controls that exist in the hosted product and the limits of those controls. It is not a certification package, a HIPAA declaration, or a penetration-test report.</p>

      <h2>What we will not claim</h2>
      <ul>
        <li>We are <strong>not</strong> HIPAA-certified and we do not state that the product is “HIPAA compliant” until a Business Associate Agreement, the safeguards below, and the agency’s procedures are in place.</li>
        <li>We do not advertise SOC 2, HITRUST, FedRAMP, or similar reports on this site unless a dated report is actually issued and linked.</li>
        <li>Readiness percentages in the product are a view of recorded work, not a guarantee of survey outcome.</li>
      </ul>

      <h2>Controls in the hosted product</h2>
      <ul>
        <li><strong>Transport.</strong> The marketing site and application are served over HTTPS.</li>
        <li><strong>Tenant isolation.</strong> Agency records carry an agency identifier. Postgres row-level security is deny-by-default. Application APIs resolve the caller’s membership; they must not trust a client-supplied agency id as authorization.</li>
        <li><strong>Access control.</strong> Roles (including administrator, house manager, nurse, DSP, and platform operator) combine with site and assignment scope. Staff should see only the homes and people they are assigned to.</li>
        <li><strong>Authentication.</strong> Provider code, username, and password. New administrators must change a temporary password. Pending agencies cannot open care records until activated.</li>
        <li><strong>Documents.</strong> Uploaded source files are hashed and stored in a private bucket using agency-scoped paths. They are not placed in a public CDN folder.</li>
        <li><strong>Audit.</strong> Sensitive events are written to an append-only store. Corrections append; they do not silently rewrite history.</li>
        <li><strong>Human review.</strong> Extracted plan items stay drafts until an authorized reviewer activates them. Signatures and delegations are named actions, not a generic checkbox.</li>
      </ul>

      <h2>Infrastructure processors</h2>
      <p>Production hosting runs on Vercel. Hosted authentication, database, and private storage run on Supabase. We do not send workspace contents to a public generative-AI provider unless an agency enables that pipeline and the contractual terms for that provider are acceptable to the agency.</p>

      <h2>Customer responsibilities</h2>
      <ul>
        <li>Assign least-privilege roles and keep site rosters current.</li>
        <li>Do not share passwords or leave a signed-in session on a shared workstation.</li>
        <li>Keep real protected records out of demo and unverified environments.</li>
        <li>Export and retain records according to the agency’s own retention schedule; ComplyRer is not the agency’s sole legal archive unless a contract says so.</li>
        <li>Complete a BAA (or equivalent) before placing PHI in the workspace.</li>
      </ul>

      <h2>Incidents</h2>
      <p>If we confirm a security incident that affects your agency’s data, we will notify the agency administrator at the email we have on file and follow applicable law. Report suspected vulnerabilities or incidents to <a href="mailto:security@complyrer.com">security@complyrer.com</a>. Please do not attach real PHI to that email.</p>

      <h2>Work still in front of us</h2>
      <p>Before ComplyRer should be used as a system of record for real sensitive data, we still expect: MFA for privileged users, a completed security review, contractual BAAs where required, verified backup restoration, and malware handling on inbound files. Those items are product and operations work—not marketing claims.</p>

      <h2>Related policies</h2>
      <p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></p>
    `,
  },
];

for (const item of pages) {
  const dest = join(root, item.file);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, page(item));
  console.log("wrote", item.file);
}
