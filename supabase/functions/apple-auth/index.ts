// 40/LOVE — Sign in with Apple token custody
//
// App Store Guideline 5.1.1(v): if you offer Sign in with Apple, deleting an
// account must also revoke the tokens Apple issued for it. This function is
// the only place that talks to Apple's token endpoints.
//
// Two actions, both authenticated as the calling member:
//   link    right after an Apple sign-in. Exchanges the authorization code
//           (valid ~5 minutes, single use) for a refresh token and stores it.
//   revoke  right before account deletion. Hands the refresh token back to
//           Apple, then drops it.
//
// Deploy:  supabase functions deploy apple-auth
//          (JWT verification ON — the caller must be a signed-in member.)
// Secrets: supabase secrets set \
//            APPLE_TEAM_ID=ABCDE12345 \
//            APPLE_KEY_ID=XYZ9876543 \
//            APPLE_CLIENT_ID=com.fortylove.app \
//            APPLE_PRIVATE_KEY="$(cat AuthKey_XYZ9876543.p8)"
//
// Until those secrets are set the function reports "not configured" with a
// 200, so sign-in and account deletion keep working while Apple enrollment is
// still in progress. Nothing here is on the critical path.

import { createClient } from "npm:@supabase/supabase-js@2";

const APPLE_TOKEN = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE = "https://appleid.apple.com/auth/revoke";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

// The .p8 Apple gives you is a PKCS#8 PEM. Secret managers are inconsistent
// about newlines, so accept both real ones and the escaped kind.
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// Apple's "client secret" is a short-lived ES256 JWT you sign yourself.
async function clientSecret(cfg: Config): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = enc({ alg: "ES256", kid: cfg.keyId, typ: "JWT" });
  const claims = enc({
    iss: cfg.teamId,
    iat: now,
    exp: now + 300,
    aud: "https://appleid.apple.com",
    sub: cfg.clientId,
  });
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(cfg.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto emits the raw r||s form, which is exactly what JWS ES256 wants.
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${b64url(new Uint8Array(sig))}`;
}

type Config = { teamId: string; keyId: string; clientId: string; privateKey: string };

function config(): Config | null {
  const teamId = Deno.env.get("APPLE_TEAM_ID");
  const keyId = Deno.env.get("APPLE_KEY_ID");
  const clientId = Deno.env.get("APPLE_CLIENT_ID");
  const privateKey = Deno.env.get("APPLE_PRIVATE_KEY");
  if (!teamId || !keyId || !clientId || !privateKey) return null;
  return { teamId, keyId, clientId, privateKey };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthenticated" }, 401);

  let body: { action?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad payload" }, 400);
  }
  const action = body.action;
  if (action !== "link" && action !== "revoke") {
    return json({ error: "action must be 'link' or 'revoke'" }, 400);
  }

  // Identify the caller from their own JWT — never from anything in the body,
  // or one member could revoke another's Apple credentials.
  const asCaller = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user }, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !user) return json({ error: "unauthenticated" }, 401);

  const cfg = config();
  if (!cfg) return json({ ok: true, skipped: "apple-not-configured" });

  // The tokens table has RLS on and no policies, so only this key reaches it.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (action === "link") {
    if (!body.code) return json({ error: "missing code" }, 400);
    const res = await fetch(APPLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: await clientSecret(cfg),
        code: body.code,
        grant_type: "authorization_code",
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.refresh_token) {
      // Not fatal: the member is signed in either way. Deletion will simply
      // have nothing to revoke, which we'd rather know about in the logs.
      console.error("apple code exchange failed", res.status, payload);
      return json({ ok: false, error: "exchange-failed" }, 200);
    }
    const { error } = await admin.from("apple_identities").upsert({
      user_id: user.id,
      refresh_token: payload.refresh_token,
      linked_at: new Date().toISOString(),
    });
    if (error) {
      console.error("apple token store failed", error);
      return json({ ok: false, error: "store-failed" }, 200);
    }
    return json({ ok: true });
  }

  // action === "revoke"
  const { data: row } = await admin
    .from("apple_identities")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row?.refresh_token) return json({ ok: true, skipped: "no-apple-identity" });

  const res = await fetch(APPLE_REVOKE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: await clientSecret(cfg),
      token: row.refresh_token,
      token_type_hint: "refresh_token",
    }),
  });
  // Apple answers 200 with an empty body on success.
  if (!res.ok) {
    console.error("apple revoke failed", res.status, await res.text().catch(() => ""));
    return json({ ok: false, error: "revoke-failed" }, 200);
  }
  await admin.from("apple_identities").delete().eq("user_id", user.id);
  return json({ ok: true });
});
