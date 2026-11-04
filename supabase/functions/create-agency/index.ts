import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCreateAgency } from "./handler.ts";

Deno.serve((req) =>
  handleCreateAgency(req, {
    env: (key) => Deno.env.get(key),
    createClient: (url, key, options) => createClient(url, key, options as never),
  }),
);
