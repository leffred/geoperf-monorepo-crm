#!/usr/bin/env node
/**
 * crm/setup_attio_fields.mjs
 * Crée les 12 custom fields GEOPERF dans Attio via API.
 * Idempotent : skip les attributes déjà existants.
 *
 * Usage (PowerShell) :
 *   $env:ATTIO_API_KEY = "ta_clé"
 *   node crm/setup_attio_fields.mjs
 *
 * Usage (bash/zsh) :
 *   ATTIO_API_KEY=ta_clé node crm/setup_attio_fields.mjs
 */

const KEY = process.env.ATTIO_API_KEY;
if (!KEY) {
  console.error("ERREUR : ATTIO_API_KEY non définie dans l'environnement.");
  console.error("PowerShell : $env:ATTIO_API_KEY = \"ta_clé\"");
  console.error("bash      : export ATTIO_API_KEY=\"ta_clé\"");
  process.exit(1);
}

const BASE = "https://api.attio.com/v2";
const HEADERS = {
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json"
};

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, body: json };
}

async function checkAuth() {
  console.log("== Vérification clé API Attio ==");
  const r = await call("GET", "/self");
  if (r.status !== 200) {
    console.error(`  [FAIL] HTTP ${r.status}`);
    if (r.body) console.error(JSON.stringify(r.body).slice(0, 400));
    process.exit(2);
  }
  console.log("  [OK] connecté");
}

async function createAttribute(obj, slug, title, type, description = "", config = {}) {
  const body = {
    data: {
      title,
      description: description || `GEOPERF custom field: ${slug}`,
      api_slug: slug,
      type,
      is_required: false,
      is_unique: false,
      is_multiselect: false,
      default_value: null,
      config
    }
  };
  const r = await call("POST", `/objects/${obj}/attributes`, body);
  if (r.ok) {
    console.log(`  [OK]    ${obj}.${slug} (${type})`);
    return true;
  }
  // Idempotence : si déjà existant, on saute
  const errMsg = JSON.stringify(r.body || "").toLowerCase();
  if (r.status === 409 || errMsg.includes("already") || errMsg.includes("duplicate") || errMsg.includes("exists")) {
    console.log(`  [SKIP]  ${obj}.${slug} déjà existant`);
    return true;
  }
  console.log(`  [FAIL]  ${obj}.${slug} → HTTP ${r.status}`);
  console.log("          " + JSON.stringify(r.body).slice(0, 400));
  return false;
}

async function addSelectOption(obj, attr, optTitle) {
  const r = await call("POST", `/objects/${obj}/attributes/${attr}/options`, {
    data: { title: optTitle }
  });
  if (r.ok) {
    console.log(`    [OK]   option '${optTitle}'`);
    return;
  }
  if (r.status === 409 || JSON.stringify(r.body || "").toLowerCase().includes("exists")) {
    console.log(`    [SKIP] option '${optTitle}' existe`);
    return;
  }
  console.log(`    [FAIL] option '${optTitle}' → HTTP ${r.status}`);
  console.log("           " + JSON.stringify(r.body).slice(0, 300));
}

(async () => {
  await checkAuth();

  console.log("\n== Création des fields People ==");
  await createAttribute("people", "geoperf_lead_score",          "Geoperf Lead Score",          "number");
  await createAttribute("people", "geoperf_status",              "Geoperf Status",              "select");
  await createAttribute("people", "geoperf_tracking_token",      "Geoperf Tracking Token",      "text");
  await createAttribute("people", "geoperf_landing_url",         "Geoperf Landing URL",         "text");
  await createAttribute("people", "geoperf_subcategory",         "Geoperf Subcategory",         "text");
  await createAttribute("people", "geoperf_downloaded_at",       "Geoperf Downloaded At",       "timestamp");
  await createAttribute("people", "geoperf_calendly_booked_at",  "Geoperf Calendly Booked At",  "timestamp");
  await createAttribute("people", "geoperf_converted_at",        "Geoperf Converted At",        "timestamp");

  console.log("\n== Ajout options pour People.geoperf_status (select) ==");
  for (const opt of ["new","queued","sequence_a","sequence_b","engaged","converted","opted_out","bounced","disqualified"]) {
    await addSelectOption("people", "geoperf_status", opt);
  }

  console.log("\n== Création des fields Companies ==");
  await createAttribute("companies", "geoperf_country",               "Geoperf Country",               "text");
  await createAttribute("companies", "geoperf_visibility_score",      "Geoperf Visibility Score",      "number");
  await createAttribute("companies", "geoperf_ai_rank",               "Geoperf AI Rank",               "number");
  await createAttribute("companies", "geoperf_market_rank_estimate",  "Geoperf Market Rank Estimate",  "number");
  await createAttribute("companies", "geoperf_ai_saturation_gap",     "Geoperf AI Saturation Gap",     "number");

  console.log("\n== Terminé ==");
  console.log("Vérifie dans Attio UI : Settings → Objects → People (et Companies) → Attributes.");
  console.log("Les attributes 'geoperf_*' doivent y figurer.");
})().catch(e => {
  console.error("\nErreur fatale :", e.message);
  process.exit(3);
});
