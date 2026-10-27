-- A missing Shift note is counted 5 minutes after that person's shift ends.
-- An agency that already saved its own grace keeps that number.

update public.rule_definitions
set platform_default = '5'::jsonb,
    help = 'A missing Shift note is counted this many minutes after that person''s shift ends.'
where key = 'documentation.note_grace_minutes'
  and platform_default = '30'::jsonb;
