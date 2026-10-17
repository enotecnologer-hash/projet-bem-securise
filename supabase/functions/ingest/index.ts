// Supabase Edge Function "ingest"
// Déploiement: supabase functions deploy ingest --no-verify-jwt
// --no-verify-jwt est acceptable ici car la fonction vérifie elle-même le token, l'origine et le domaine.
// Le service role ne quitte jamais cette fonction.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_TYPES = new Set([
  "formulaire_abandonne",
  "erreur_api",
  "page_lente",
  "fichier_casse",
  "erreur_js",
]);
// Ces types ne sont acceptés que si le navigateur déclare un consentement (consent: true).
const BEHAVIORAL_TYPES = new Set(["formulaire_abandonne"]);
const MAX_EVENTS = 50;
const MAX_TEXT = 2048;
const MAX_BODY = 64 * 1024;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-bem-token",
  "access-control-max-age": "86400",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (request) => {
  // Préflight CORS (nécessaire si le client envoie le header x-bem-token).
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const origin = request.headers.get("origin");
  if (!origin) return json({ error: "Origine requise" }, 403);

  // audit.js envoie du JSON en text/plain (requête simple): on lit le texte puis on parse.
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "Requête trop volumineuse" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Corps JSON invalide" }, 400);
  }

  const bodyToken = isRecord(body) && typeof body.token === "string" ? body.token : null;
  const token = request.headers.get("x-bem-token") || bodyToken;
  if (!token || token.length > 256) return json({ error: "Token invalide" }, 401);

  const events = Array.isArray(body) ? body : isRecord(body) ? body.events : undefined;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS) {
    return json({ error: "Lot invalide" }, 400);
  }

  const { data: domains, error: domainError } = await supabase
    .from("domains")
    .select("id, organization_id, domain_name")
    .eq("verification_token", token)
    .eq("is_verified", true)
    .limit(1);

  if (domainError || !domains?.[0]) return json({ error: "Domaine non autorisé" }, 403);
  const domain = domains[0];
  if (!originMatchesDomain(origin, domain.domain_name)) {
    return json({ error: "Origine non autorisée" }, 403);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const event of events) {
    if (!isRecord(event)) continue;
    const type = String(event.type);
    if (!ALLOWED_TYPES.has(type)) continue;
    // Sans consentement, on ignore seulement l'événement comportemental (les erreurs techniques passent).
    if (BEHAVIORAL_TYPES.has(type) && event.consent !== true) continue;
    rows.push({
      domain_id: domain.id,
      organization_id: domain.organization_id,
      type,
      session_id: truncateText(event.session_id),
      url: stripQuery(String(event.url ?? origin)),
      metadata: sanitizeMetadata(event.metadata),
      perte_dh: 0,
    });
  }

  if (rows.length === 0) return json({ accepted: 0 });

  // Limitation de débit par domaine (voir security.sql). Au-delà: 429 sans rien enregistrer.
  const { data: allowed, error: rateError } = await supabase.rpc("ingest_allowed", {
    p_domain_id: domain.id,
    p_events: rows.length,
  });
  if (rateError) return json({ error: "Limitation indisponible" }, 500);
  if (allowed === false) return json({ error: "Trop de requêtes" }, 429, { "retry-after": "60" });

  // La perte est TOUJOURS calculée ici à partir de loss_rules. Toute valeur envoyée par le navigateur est ignorée.
  const { data: rules, error: rulesError } = await supabase
    .from("loss_rules")
    .select("event_type, amount_dh")
    .eq("organization_id", domain.organization_id);
  if (rulesError) return json({ error: "Règles indisponibles" }, 500);

  const amounts = new Map(
    (rules ?? []).map((rule: { event_type: string; amount_dh: number | string }) => [rule.event_type, Number(rule.amount_dh)] as [string, number]),
  );
  const calculated = rows.map((row) => ({ ...row, perte_dh: amounts.get(row.type as string) ?? 0 }));

  // Le trigger bump_daily_loss met à jour daily_losses après cet insert.
  const { error: insertError } = await supabase.from("error_events").insert(calculated);
  if (insertError) return json({ error: "Événements non enregistrés" }, 500);

  return json({ accepted: calculated.length });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, 200);
}

function stripQuery(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, MAX_TEXT);
  } catch {
    return value.split(/[?#]/, 1)[0].slice(0, MAX_TEXT);
  }
}

function originMatchesDomain(origin: string, domainName: string): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
    const expected = domainName.toLowerCase().replace(/^www\./, "");
    return hostname === expected || hostname.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (typeof item === "string") output[key.slice(0, 80)] = item.slice(0, 500);
    else if (typeof item === "number" || typeof item === "boolean") output[key.slice(0, 80)] = item;
  }
  return output;
}

function json(data: Record<string, unknown>, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json", ...extra },
  });
}
