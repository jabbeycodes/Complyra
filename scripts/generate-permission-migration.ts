import { writeFileSync } from "node:fs";
import { ROLE_TEMPLATES } from "../src/data/permissions";

const rows = ROLE_TEMPLATES.map((role) => `('${role.key}', '${JSON.stringify(role.permissions).replaceAll("'", "''")}'::jsonb)`).join(",\n");
writeFileSync("supabase/migrations/20260915024000_integrated_permissions.sql", `-- Generated from src/data/permissions.ts; preserves all explicit agency overrides.
insert into public.role_permission_matrix(role_key,permissions) values
${rows}
on conflict(role_key) do update set permissions=excluded.permissions,updated_at=now();

-- Missing new capabilities inherit their canonical defaults. Existing choices win.
update public.role_templates t set permissions=m.permissions || t.permissions
from public.role_permission_matrix m where m.role_key=t.key;
update public.agency_roles a set permissions=m.permissions || a.permissions
from public.role_permission_matrix m where m.role_key=a.template_key;
`);
