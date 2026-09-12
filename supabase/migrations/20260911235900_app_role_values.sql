-- New capability classes used by role templates. Separate transaction from their use.
alter type public.app_role add value if not exists 'nurse';
alter type public.app_role add value if not exists 'hr';
alter type public.app_role add value if not exists 'auditor';
