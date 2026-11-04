-- Wave 7I (simulation batches 40 + 50): the New Hire Binder sent new
-- hires to sign twelve policy documents that did not exist. The
-- binder's acknowledgment items match HR library documents by title,
-- but hosted provisioning never seeded the library — create-agency
-- created the agency, its administrator, and (by trigger) its role
-- templates, and nothing else — so a new agency's Documents tab read
-- "No HR documents yet" while its binders said "Open Documents to
-- sign". This migration provisions the starter policy library the
-- binder expects, the same way role templates are provisioned:
-- a security-definer function, an AFTER INSERT trigger on agencies,
-- and a one-time backfill for existing agencies.
--
-- The twelve starter documents are the agency's own starter copies
-- (ComplyRer-original text, marked as starter copy inside every body)
-- for agency leadership to review and edit. Titles and bodies mirror
-- src/data/starterDocuments.ts (STARTER_POLICY_DOCUMENTS) exactly —
-- the unit tests pin that parity.
--
-- Provisioning is insert-only and title-matched: an agency that
-- already has a document under a starter title keeps its own text,
-- and a title an agency has deactivated is not resurrected (the row
-- still exists). Nothing is ever updated or deleted here.

-- System-provisioned starter rows have no human creator; a human
-- author is still recorded for every document a person adds.
alter table public.hr_documents alter column created_by drop not null;

create or replace function public.provision_agency_starter_documents(p_agency_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.hr_documents
    (agency_id, title, category, body, file_url, requires_ack, active, created_by)
  select p_agency_id, s.title, 'policy', s.body, null, true, true, null
  from (values
    ('Onboarding Packet', $starter1$Welcome to the agency. This packet is the starting point for your first days with us, and signing it confirms you received it and know where to find each part.

It covers: your offer letter and job description; your first-week schedule and who you report to; the homes and Individuals you may support; the training you must finish before working alone; and the binder checklist that tracks every document in your new hire file.

Bring photo identification and any current certifications (such as CPR and medication aide credentials) to your first shift so HR can copy them into your file. If anything in this packet conflicts with what you are told on shift, ask your house manager — do not guess.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter1$),
    ('HIPAA 107', $starter2$The Individuals we support trust us with private health information. Federal HIPAA rules and agency policy protect that information, and every staff member is responsible for keeping it private.

Share health information only with people who need it to do their job — the care team, your house manager, the nurse, and program leadership. Never discuss an Individual's health, medications, or behavior where visitors, other Individuals, or the public can hear. Do not photograph, copy, or take home any health record, and do not look up records for anyone you do not support.

Keep paper records in their designated place and lock screens when you step away. If you think private information was shared with the wrong person — by you or anyone else — tell your house manager or HR the same day. Hiding a mistake makes it worse; reporting it protects the Individual and you.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter2$),
    ('HELP Protocol 207', $starter3$Asking for help early is part of doing this job well. The HELP protocol is the agency's chain for getting support before a hard moment becomes an emergency.

Use it when: an Individual's behavior is escalating beyond the strategies in their plan; you are unsure how to carry out a care task safely; staffing, transportation, or medication supplies fall short; or you feel a situation is becoming unsafe for anyone in the home.

Start with your house manager. If they cannot be reached, contact the program manager, then the on-call supervisor — keep going up the chain until a person answers. Never leave an Individual unsupported while you seek help; if someone must stay, say so clearly to the person you reach.

After the situation settles, document what happened and what support you received, factually and the same shift.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter3$),
    ('Abuse & Neglect 200', $starter4$Every Individual has the right to be free from abuse, neglect, and exploitation. Every staff member is a mandated reporter: if you see it, suspect it, or are told about it, you must report it — you do not need proof, and you never investigate on your own.

Abuse includes hitting, slapping, pushing, rough handling, yelling, threats, humiliation, unwanted sexual contact, and taking or borrowing an Individual's money or belongings. Neglect includes failing to provide food, medication, supervision, hygiene care, or medical attention the Individual needs.

Report immediately: first make sure the Individual is safe, then tell your house manager and follow the agency's reporting steps for the state hotline the same shift. Write down exactly what you saw and heard, with dates and times — facts only, no opinions.

No one may punish you for making a report in good faith. Retaliation against a reporter is itself a violation.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter4$),
    ('Event Reporting 205', $starter5$An event is anything unusual that affects an Individual's health, safety, or services: an injury or fall, a medication error or refusal, a behavior that causes harm or risk, a medical concern, property damage, an elopement or missing person, or a visit from emergency services or law enforcement.

Report every event the same shift it happens. Tell your house manager right away for anything serious, and complete the agency's event report before your shift ends — while the details are fresh. Write facts only: what happened, when, who was present, what you did, and the Individual's condition afterward. Do not include guesses, blame, or opinions.

Late and missing reports are compliance failures, even when care itself was good. If you are unsure whether something counts as an event, report it — your house manager would rather have the report than miss one.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter5$),
    ('Infection Control 210', $starter6$Clean hands and clean homes keep Individuals and staff healthy. Hand hygiene is the single most important habit: wash with soap and water or use sanitizer when you arrive, before and after personal care, before handling food or medication, after toileting support, and after coughing, sneezing, or handling trash.

Wear gloves for personal care, toileting, first aid, and cleaning body fluids — and change them between tasks and between Individuals. Gloves never replace hand washing. Clean and disinfect shared surfaces, bathrooms, and kitchen areas on the home's cleaning schedule, and handle laundry and waste the way your house manager shows you.

Stay home when you are sick, and tell your house manager as early as you can. If an Individual shows signs of illness — fever, vomiting, diarrhea, a new rash or cough — take their temperature if trained, note the symptoms, and notify the nurse or house manager the same shift.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter6$),
    ('Emergency Preparedness 204', $starter7$Every home has an emergency plan, and every staff member must know it before an emergency happens. Learn your home's fire exits, meeting point, extinguisher locations, severe-weather shelter area, and where emergency contact information is posted.

Fire: get every Individual out first — do not stop for belongings — then call 911 from outside and account for everyone at the meeting point. Severe weather: move Individuals to the home's shelter area away from windows and stay there until the warning passes. Medical emergency: start first aid or CPR if you are trained, have someone call 911, and send a person to meet responders at the door.

Drills happen on schedule in every home, on every shift. Treat each drill like the real thing — they are how we prove everyone can get out safely, and drill records are reviewed in audits.

After any real emergency, notify your house manager and document what happened the same shift.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter7$),
    ('Dress Code 203', $starter8$Dress for the work: clean, professional clothing that lets you move, bend, and respond quickly and safely. Closed-toe shoes with secure footing are required on every shift.

Wear your ID badge where it can be seen. Keep nails short and clean for personal care and medication support. Avoid dangling jewelry, loose scarves, and anything an Individual could grab during a behavior episode. Clothing with offensive words or images is not permitted.

Personal hygiene matters in close care work: arrive clean, manage strong fragrances (some Individuals are sensitive to them), and keep a change of clothes available in case a shift gets messy.

If you are ever unsure whether something is appropriate to wear on shift, ask your house manager before the shift — not during it.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter8$),
    ('Vehicle Use Agreement', $starter9$Driving Individuals is a position of trust. You may transport Individuals only when you hold a valid driver's license, are cleared in your driver file, and are assigned to drive.

Before every trip: confirm every passenger is seat-belted, check that you have the Individual's emergency information, and make sure the vehicle has fuel and is safe to drive. Never use a phone while the vehicle is moving — pull over and park to call or text. Never drive under the influence of alcohol, drugs, or medication that makes you drowsy, and never smoke in an agency or trip vehicle.

Drive the posted limits, plan the route before leaving, and log the trip and mileage the way your house manager directs. Report every accident, ticket, vehicle problem, or change to your license or insurance to your house manager the same day — small problems reported early stay small.

By signing, you agree to these terms each time you drive for the agency.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter9$),
    ('HCBS', $starter10$Our services are funded through Home and Community-Based Services (HCBS), which carries a simple promise: the Individuals we support live full lives in their community, with the same rights and choices as anyone else.

That means services are person-centered. The Individual's own goals, preferences, and routines drive the plan — not staff convenience. Individuals choose how to spend their time, who they spend it with, what they eat, and when they do things, with support to make those choices real: community outings, work, worship, friendships, and privacy at home.

Support independence rather than doing things for someone by default. Teach, prompt, and assist at the level the plan describes, and step back as skills grow. Restrictions on an Individual's choices are never a staff decision — they belong in the plan, with the team and guardian, and are reviewed.

If you see a routine in the home that exists mainly for staff convenience, raise it with your house manager. That question is exactly the kind HCBS asks us to keep asking.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter10$),
    ('Individual Rights Cover Page', $starter11$Every Individual we support keeps all of their rights as a person and a citizen. Our job is to uphold those rights, never to hold them as privileges that can be earned or taken away.

Individuals have the right to: be treated with dignity and respect; privacy in their home, belongings, communications, and personal care; make choices about their daily life, food, activities, and relationships; practice their own religion or none; communicate freely, including private phone calls and mail; manage their own money with the support in their plan; be free from abuse, neglect, exploitation, and unnecessary restraint; receive services described in their plan; and raise complaints and grievances without fear of retaliation.

If you believe an Individual's rights are being limited or ignored — by anyone, including another staff member — report it to your house manager or program leadership the same day. Signing this cover page confirms you received the agency's full Individual Rights statement and understand your duty to protect these rights.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter11$),
    ('ISP Acknowledgment', $starter12$The Individual Support Plan (ISP) is the plan of record for each person we support: their goals, health needs, behavior support strategies, risks, and the services our agency is responsible for delivering.

Before you support an Individual on your own, read their current ISP — including the behavior support strategies and any health protocols — and ask your house manager about anything you do not understand. The plan is not optional reading: medication supports, alone time, dietary needs, and responses to behavior all come from it, and following a strategy the plan does not contain (or skipping one it does) can put the Individual and you at risk.

Document your work against the plan as you go. When you notice a change — a new behavior, a health concern, a goal the Individual has outgrown or lost interest in — tell your house manager so the team can review the plan. Plans are reviewed at least annually and whenever needs change.

Signing confirms you understand this duty and will read the current ISP for every Individual you support.

Starter copy provided by Complyrer — your agency should review and edit this text so it matches its own adopted policy before staff sign it.$starter12$)
  ) as s(title, body)
  where not exists (
    select 1
    from public.hr_documents d
    where d.agency_id = p_agency_id
      and lower(d.title) = lower(s.title)
  );
$$;

-- Backfill: every existing agency gains the starter documents it lacks.
select public.provision_agency_starter_documents(id) from public.agencies;

create or replace function private.agency_created_starter_documents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.provision_agency_starter_documents(new.id);
  return new;
end;
$$;

drop trigger if exists agencies_provision_starter_documents on public.agencies;
create trigger agencies_provision_starter_documents
after insert on public.agencies
for each row execute function private.agency_created_starter_documents();
