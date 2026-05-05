// GEOPERF SaaS — saas_demo_login
// S20 §4.5 : retourne une session JWT 24h pour l'utilisateur demo seedé en phase 13.
// Trigger : POST {} (pas de body required) → { access_token, refresh_token, user: { id, email } }
//
// Securite :
// - L'Edge Function est deployee SANS verify_jwt (--no-verify-jwt) car appellee par /demo
//   anonyme (pas de session existante).
// - Rate limit : Supabase Edge limite naturellement les invocations par IP. Pour
//   reinforcer, ajouter un middleware /api/saas/demo-login cote Vercel qui throttle 1/min/IP.
// - La page /demo et le middleware /app/* check user.id == DEMO_USER_ID pour bloquer
//   les mutations (mode readonly).
//
// Implementation : utilise auth.signInWithPassword avec un mot de passe demo connu
// (seed phase 13 + env var DEMO_USER_PASSWORD pour eviter de hardcoder).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEMO_USER_EMAIL = Deno.env.get("DEMO_USER_EMAIL") ?? "demo@geoperf.com";
const DEMO_USER_PASSWORD = Deno.env.get("DEMO_USER_PASSWORD") ?? "DemoGeoperf-2026-Public";

// Client anonyme pour signInWithPassword (pas service_role car on veut une vraie session JWT)
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "content-type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: corsHeaders });
  }

  try {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email: DEMO_USER_EMAIL,
      password: DEMO_USER_PASSWORD,
    });
    if (error || !data.session) {
      console.error("[saas_demo_login] signInWithPassword failed:", error?.message);
      return new Response(
        JSON.stringify({ error: "demo_login_failed", details: error?.message ?? "no session" }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        expires_at: data.session.expires_at,
        token_type: data.session.token_type,
        user: { id: data.user?.id, email: data.user?.email },
      }),
      { headers: corsHeaders }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_demo_login ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
