-- Evergreen demo roster rename (#58). Historical migrations still look up
-- Maple House for one-time nurse membership repairs; this updates live rows
-- so hosted demo matches Cedar / Willow and the new Individuals.
--
-- Rename-only. Preview and production share one hosted project, so this file
-- does not apply until `supabase db push`. It also does not delete leftover
-- Individuals (QA Person, Jordan, Ethan, Olivia, Ava, …). The follow-up
-- 20260915200000_demo_roster_repair.sql is the idempotent hosted wipe.

update public.sites
set name = 'Cedar House',
    address = '418 Cedar Court'
where name = 'Maple House';

update public.sites
set name = 'Willow House',
    address = '920 Willow Lane'
where name = 'Oakwood House';

update public.individuals set full_name = 'Ellis Hart' where full_name = 'Jodie Williams';
update public.individuals set full_name = 'Morgan Pruitt' where full_name = 'Brandon Miller';
update public.individuals set full_name = 'Reese Lang' where full_name = 'Sylvester Jones';
update public.individuals set full_name = 'Harper Soto' where full_name = 'Maya Johnson';
