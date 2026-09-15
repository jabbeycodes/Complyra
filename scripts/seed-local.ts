/** Seed only the disposable Supabase instance running on this machine. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const config = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
assert.match(config.API_URL, /^http:\/\/(127\.0\.0\.1|localhost):/, 'Only a local backend can be seeded by this command');
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed-evergreen.ts'], {
  env: { ...process.env, SUPABASE_URL: config.API_URL, SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY }, stdio: 'inherit',
});
