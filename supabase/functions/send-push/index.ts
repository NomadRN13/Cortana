// 40/Love — push sender
// Triggered by a Supabase Database Webhook on INSERT into public.notifications.
// Looks up the recipient's device tokens and relays through Expo's push API.
//
// Deploy:   supabase functions deploy send-push --no-verify-jwt
// Secrets:  supabase secrets set PUSH_WEBHOOK_SECRET=<long random string>
// Webhook:  Dashboard → Database → Webhooks → new webhook on
//           public.notifications INSERT → HTTP POST to this function's URL,
//           with header  x-webhook-secret: <the same secret>
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from "npm:@supabase/supabase-js@2";

const TITLES: Record<string, string> = {
  match: "It's a Match Point! 🎾",
  message: "Your serve",
  court_time: "Court time proposed",
  event_reminder: "You've got court time coming up",
  system: "40/Love",
};

const BODIES: Record<string, string> = {
  match: "You have a new match. The court is the icebreaker — say hi.",
  message: "New message waiting for you.",
  court_time: "Someone wants to meet on the court. Accept or suggest another time.",
  event_reminder: "An event you joined is coming up soon.",
  system: "Open the app for an update.",
};

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("PUSH_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  let payload: { type?: string; record?: { user_id?: string; kind?: string; payload?: unknown } };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const record = payload.record;
  if (payload.type !== "INSERT" || !record?.user_id) {
    return new Response("ignored", { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tokens, error } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", record.user_id);

  if (error) return new Response(`token lookup failed: ${error.message}`, { status: 500 });
  if (!tokens || tokens.length === 0) return new Response("no tokens", { status: 200 });

  const kind = record.kind ?? "system";
  const messages = tokens.map((t) => ({
    to: t.token,
    title: TITLES[kind] ?? TITLES.system,
    body: BODIES[kind] ?? BODIES.system,
    data: { kind, payload: record.payload ?? {} },
    sound: "default",
  }));

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });

  // Expo returns per-message receipts; DeviceNotRegistered means the token
  // is dead — prune it so we stop sending to uninstalled apps.
  try {
    const result = await res.json();
    const dead: string[] = [];
    (result.data ?? []).forEach((r: { status: string; details?: { error?: string } }, i: number) => {
      if (r.status === "error" && r.details?.error === "DeviceNotRegistered") {
        dead.push(messages[i].to);
      }
    });
    if (dead.length) {
      await supabase.from("push_tokens").delete().in("token", dead);
    }
  } catch {
    /* receipt parsing is best-effort */
  }

  return new Response("ok", { status: 200 });
});
