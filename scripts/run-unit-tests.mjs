import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function testsIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? testsIn(path) : /\.test\.tsx?$/.test(path) ? [path] : [];
  });
}
const files = [...testsIn("src"), ...testsIn("supabase/functions")].sort();
const result = spawnSync(process.execPath, ["--import", "tsx", "--import", "./src/testSupport/cssStub.mts", "--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
