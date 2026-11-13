// The complete API surface between the app and Supabase. Each function maps
// to the schema in supabase/migrations/ (verified by the SQL test harness).
// src/state.js swaps its demo actions for these once the backend is live —
// the function signatures mirror the state actions on purpose.
import { supabase } from '../lib/supabase';
import { revokeAppleAccount } from '../lib/socialAuth';

// ---------- Auth ----------

export async function signInWithEmail(email) {
  // Magic-link / OTP sign-in; no passwords to forget court-side.
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function verifyOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// ---------- Phone verification ----------
// Attaches the number to the auth user (Supabase sends the SMS code) and,
// once verified, syncs the trusted flag onto the profile via an RPC that
// only believes auth's own confirmation.

export async function startPhoneVerification(phoneE164) {
  const { error } = await supabase.auth.updateUser({ phone: phoneE164 });
  if (error) throw error;
}

export async function confirmPhoneVerification(phoneE164, token) {
  const { error } = await supabase.auth.verifyOtp({ phone: phoneE164, token, type: 'phone_change' });
  if (error) throw error;
  return syncPhoneVerification();
}

export async function syncPhoneVerification() {
  const { data, error } = await supabase.rpc('sync_phone_verification');
  if (error) throw error;
  return data === true;
}

export async function deleteAccount() {
  // In-app account deletion — required by both app stores.
  //
  // Photos are deleted here, through the Storage API, because that is the only
  // call that removes the actual image file. delete_account() drops the
  // matching rows from storage.objects, which makes a photo unreachable, but
  // the bytes would survive in the bucket — and the privacy policy promises
  // they don't. Belt and braces: this deletes the files, the RPC guarantees
  // nothing is left pointing at them even if this half fails.
  await purgeMyPhotoFiles();
  // And if they got in with Apple, tell Apple to drop the account too — App
  // Store guideline 5.1.1(v). Must happen before the row goes, since the token
  // it needs is stored against the account. Never throws.
  await revokeAppleAccount();
  const { error } = await supabase.rpc('delete_account');
  if (error) throw error;
  await supabase.auth.signOut();
}

// Every object under the caller's own folder in the photos bucket. Listed
// rather than read from profile_photos so an upload that half-failed — file
// written, row never inserted — is caught too.
async function purgeMyPhotoFiles() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase.storage.from('photos').list(user.id, { limit: 100 });
  // A listing failure must not trap someone in an account they asked to
  // delete; the RPC still makes the photos unreachable.
  if (error || !data || !data.length) return;
  await supabase.storage.from('photos').remove(data.map((f) => `${user.id}/${f.name}`));
}

// ---------- Profile ----------

// Both of these go through RPCs rather than selecting from profiles, because
// birthdate and the approximate coordinates are no longer readable through the
// table by anyone — see migration 20260806000018. Row-level security decides
// which ROWS you may read, never which columns, so `select=birthdate` on any
// row you were allowed to see returned it.
// The row also carries `tier` ('free' | 'plus' | 'club') and `timezone`; a
// member can read both and write neither directly (tier is the desk's, and the
// timezone goes through setMyTimezone below).
export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) throw error;
  return data || null;
}

// Match cards for other members, entirely from get_profile_cards: an age
// instead of a birthdate, a verified flag instead of a timestamp, and no
// coordinates, city or last-active time at all — distance comes from the deck,
// which works it out without handing over anyone's position. Members can read
// only id and first_name of other profiles directly (migration
// 20260806000030), so everything a card shows, partner_gender and play_games
// included, comes back from the function. Suspended members' cards are left out.
export async function getProfilesByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.rpc('get_profile_cards', { p_ids: ids });
  if (error) throw error;
  return data || [];
}

// Partial profile update (prefs, bio, activity ping) — only the given fields.
// Position, verification, suspension and created_at can't be written this way:
// the database refuses them from a member's session (migration 20260806000030).
// Position goes through setMyLocation below.
export async function updateMyProfile(fields) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('profiles').update(fields).eq('id', user.id);
  if (error) throw error;
}

// Coarse position, the only way to set it. The server rounds to 2 decimals
// (about 1 km), refuses something that isn't a place, and lets you move to a
// different ~2.5-mile grid square at most once every 6 hours — sooner than
// that it answers { accepted: false, retry_after } and the old position stands.
// That isn't an error; the app carries on and tries again next launch. It
// raises (P0002) if the profile row doesn't exist yet, so call it after signup.
//   → { accepted: boolean, moved: boolean, retry_after?: timestamp }
export async function setMyLocation(lat, lng) {
  const { data, error } = await supabase.rpc('set_my_location', {
    // Rounded here too, so exact coordinates never leave the phone.
    p_lat: Math.round(lat * 100) / 100,
    p_lng: Math.round(lng * 100) / 100,
  });
  if (error) throw error;
  return data || null;
}

// The phone's timezone, as an IANA name ("America/Indiana/Indianapolis"). The
// server uses it for one thing: holding push notifications back during quiet
// hours, 10pm to 8am where the member is. It refuses a name it doesn't know.
export async function setMyTimezone(tz) {
  const { error } = await supabase.rpc('set_my_timezone', { p_tz: tz });
  if (error) throw error;
}

// A new profile starts with no position (the database clears one if sent);
// the app sets it afterwards with setMyLocation.
//
// Insert, and if the profile is already there (signing up again on a second
// phone, or retrying after a dropped connection), update it. Not PostgREST's
// upsert: INSERT ... ON CONFLICT DO UPDATE needs read access to every column it
// copies over, and members can only read id and first_name of the profiles
// table (migration 20260806000030; birthdate was already hidden since 18), so
// the database refuses it. Plain insert and update need no read access.
export async function upsertMyProfile({ firstName, birthdate, bio, availabilityNote, modes, radiusMi, ageMin, ageMax, sameSportsOnly, city, extraCities, gender, seeking, playGames, playPref, friendsPref, isTeam, partnerName, partnerBirthdate, partnerGender }) {
  const { data: { user } } = await supabase.auth.getUser();
  const fields = {
    first_name: firstName,
    birthdate,
    bio: bio ?? '',
    availability_note: availabilityNote ?? '',
    modes,
    radius_mi: radiusMi,
    age_min: ageMin,
    age_max: ageMax,
    same_sports_only: sameSportsOnly,
    city,
    // Any cities beyond the home one. The database drops repeats and the home
    // city itself, and refuses a slug it doesn't know.
    extra_cities: extraCities || [],
    gender: gender || null,
    seeking: seeking || [],
    play_games: playGames && playGames.length ? playGames : ['singles', 'doubles', 'mixed_doubles'],
    play_pref: playPref || 'everyone',
    friends_pref: friendsPref || 'everyone',
    is_team: !!isTeam,
    // Cleared rather than left stale when a team goes back to playing solo.
    partner_name: isTeam ? (partnerName || '') : '',
    partner_birthdate: isTeam ? (partnerBirthdate || null) : null,
    partner_gender: isTeam ? (partnerGender || null) : null,
    last_active_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('profiles').insert({ id: user.id, ...fields });
  if (!error) return;
  // 23505: unique_violation — the row exists, so save over it instead.
  if (error.code !== '23505') throw error;
  const { error: updErr } = await supabase.from('profiles').update(fields).eq('id', user.id);
  if (updErr) throw updErr;
}

export async function setMySports(sports) {
  // sports: [{ sport: 'tennis', level: 'advanced', ratingLabel: 'NTRP 4.0' }]
  const { data: { user } } = await supabase.auth.getUser();
  const { error: delErr } = await supabase.from('user_sports').delete().eq('user_id', user.id);
  if (delErr) throw delErr;
  const { error } = await supabase.from('user_sports').insert(
    sports.map((s) => ({ user_id: user.id, sport: s.sport, level: s.level, rating_label: s.ratingLabel ?? '' }))
  );
  if (error) throw error;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i += 1) t[B64.charCodeAt(i)] = i;
  return t;
})();

// Storage wants an ArrayBuffer. Hermes has shipped `atob` for a while, so use
// it when it's there — but a photo upload that silently depends on a global
// being present is how B-09 happened the first time, and the failure mode is a
// member whose profile shows initials to everyone but themselves.
function base64ToArrayBuffer(b64) {
  if (typeof atob === 'function') return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  let clean = '';
  for (let i = 0; i < b64.length; i += 1) {
    const c = b64.charCodeAt(i);
    if (c < 128 && B64_INDEX[c] >= 0) clean += b64[i];
  }
  const out = new Uint8Array((clean.length * 3) >> 2);
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    buf = (buf << 6) | B64_INDEX[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o] = (buf >> bits) & 0xff; o += 1; }
  }
  return out.buffer;
}

export async function uploadProfilePhoto(localUri, position = 0) {
  const { data: { user } } = await supabase.auth.getUser();
  // Unique filename per upload: positions can be reordered, so the path
  // must never be derived from the slot (or a replace could clobber a
  // different slot's file).
  const path = `${user.id}/${Date.now()}.jpg`;
  // Read via expo-file-system: RN's fetch is unreliable for file:// bodies (QA B-09).
  const FileSystem = require('expo-file-system');
  const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const { error: upErr } = await supabase.storage.from('photos').upload(path, base64ToArrayBuffer(b64), {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (upErr) throw upErr;
  const { data: existing } = await supabase
    .from('profile_photos')
    .select('storage_path')
    .eq('user_id', user.id)
    .eq('position', position)
    .maybeSingle();
  const { error } = await supabase.from('profile_photos').upsert(
    // Status is enforced server-side (always re-enters moderation) — sent
    // here only for clarity.
    { user_id: user.id, storage_path: path, position, moderation_status: 'pending' },
    { onConflict: 'user_id,position' }
  );
  if (error) throw error;
  if (existing && existing.storage_path && existing.storage_path !== path) {
    // replaced slot: clean up the old binary (best-effort)
    supabase.storage.from('photos').remove([existing.storage_path]).then(() => {}, () => {});
  }
  return path;
}

// Short-lived display URLs for photo paths (the bucket is private).
export async function signPhotoUrls(paths) {
  if (!paths.length) return [];
  const { data, error } = await supabase.storage.from('photos').createSignedUrls(paths, 3600);
  if (error || !data) return paths.map(() => null);
  return data.map((d) => d.signedUrl || null);
}

export async function listMyPhotos() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('profile_photos')
    .select('storage_path, position, moderation_status')
    .eq('user_id', user.id)
    .order('position');
  if (error) throw error;
  const urls = await signPhotoUrls(data.map((r) => r.storage_path));
  return data.map((r, i) => ({ position: r.position, status: r.moderation_status, url: urls[i] }));
}

// Approved photos for a set of users → { userId: [url, …] } in position order.
// RLS already filters to your own, or approved ones of people in your profile
// list (not blocked either way, not suspended), but we filter explicitly anyway.
export async function getApprovedPhotoMap(userIds) {
  if (!userIds.length) return {};
  const { data, error } = await supabase
    .from('profile_photos')
    .select('user_id, storage_path, position')
    .in('user_id', userIds)
    .eq('moderation_status', 'approved')
    .order('position');
  if (error || !data || !data.length) return {};
  const urls = await signPhotoUrls(data.map((r) => r.storage_path));
  const map = {};
  data.forEach((r, i) => {
    if (!urls[i]) return;
    if (!map[r.user_id]) map[r.user_id] = [];
    map[r.user_id].push(urls[i]);
  });
  return map;
}

export async function deleteProfilePhoto(position) {
  const { error } = await supabase.rpc('delete_photo', { p_position: position });
  if (error) throw error;
}

export async function makePhotoPrimary(position) {
  const { error } = await supabase.rpc('make_photo_primary', { p_position: position });
  if (error) throw error;
}

// ---------- Discovery ----------

export async function fetchDeck(mode, limit = 20) {
  const { data, error } = await supabase.rpc('get_discovery_deck', { p_mode: mode, p_limit: limit });
  if (error) throw error;
  // [{ user_id, first_name, age, distance_mi, sports, verified, availability_note, bio, is_new,
  //    is_team, partner_name, partner_age, gender, partner_gender, play_games }]
  // Already in ranked order; the score itself stays on the server.
  // distance_mi is whole miles between ~2.5-mile grid squares (1 = same square,
  // i.e. nearby), and null for someone in another metro (a second city of
  // yours) or over 100 miles away, not a huge number. At most 100 rows.
  return data;
}

export async function swipe(targetId, mode, action) {
  // action: 'like' | 'pass' | 'ace'. Match creation happens in the DB trigger;
  // detect it by checking for a match with this user right after.
  const { error } = await supabase.from('swipes').insert({ target_id: targetId, mode, action, actor_id: (await supabase.auth.getUser()).data.user.id });
  if (error) throw error;
  if (action === 'pass') return null;
  const { data } = await supabase
    .from('matches')
    .select('id, user_a, user_b, mode, created_at')
    .eq('mode', mode)
    .is('closed_at', null)
    .or(`user_a.eq.${targetId},user_b.eq.${targetId}`)
    .maybeSingle();
  return data; // null = no match yet; row = It's a Match Point!
}

export async function undoSwipe(targetId, mode) {
  // Takes back the last swipe on this person in this mode; false when a
  // conversation already exists (the server never deletes those).
  const { data, error } = await supabase.rpc('undo_swipe', { p_target: targetId, p_mode: mode });
  if (error) throw error;
  return data === true;
}

// ---------- Matches & chat ----------

export async function listMatches() {
  const { data, error } = await supabase
    .from('matches')
    .select('id, user_a, user_b, mode, created_at, closed_at')
    .is('closed_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listMessages(matchId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('match_id', matchId)
    .order('sent_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function sendTextMessage(matchId, body) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('messages').insert({ match_id: matchId, sender_id: user.id, kind: 'text', body });
  if (error) throw error;
}

export async function proposeCourtTime(matchId, { venue, day, time, sport }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('messages').insert({
    match_id: matchId,
    sender_id: user.id,
    kind: 'court_time',
    court_payload: { venue, day, time, sport, status: 'proposed' },
  });
  if (error) throw error;
}

export async function respondCourtTime(messageId, accept) {
  const { data, error } = await supabase.rpc('respond_court_time', { p_message_id: messageId, p_accept: accept });
  if (error) throw error;
  return data;
}

export async function markMessagesRead(matchId) {
  // Sets read_at on the OTHER side's unread messages (scoped RPC — direct
  // message updates are not possible, by design).
  const { error } = await supabase.rpc('mark_messages_read', { p_match: matchId });
  if (error) throw error;
}

export function subscribeToNotifications(userId, onInsert) {
  // Live signal for matches created by the other person's like (B-21) and
  // messages arriving outside an open conversation. RLS means only this
  // user's rows ever arrive.
  const channel = supabase
    .channel(`notifs:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => onInsert(payload.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function subscribeToMessages(matchId, onEvent) {
  // Realtime: new messages arrive as INSERTs; court-time accept/decline
  // arrives as an UPDATE to the proposal row (QA B-08).
  const channel = supabase
    .channel(`match:${matchId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` }, (payload) => onEvent('INSERT', payload.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` }, (payload) => onEvent('UPDATE', payload.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ---------- Events ----------

// Meetups for the given cities — the ones on the member's profile. Each city
// runs its own calendar, so cities are required: asking without any returns
// nothing rather than quietly falling back to every city in the country.
// Each row carries price_cents (null when there is nothing to pay),
// club_discount_pct and general_opens_at (before it, only Club members can
// RSVP), and each RSVP its waiver_accepted_at / checked_in_at — stamps only
// the server can write (accept_event_waiver, check_in_event).
export async function listEvents(cities) {
  const list = (Array.isArray(cities) ? cities : [cities]).filter(Boolean);
  if (!list.length) return [];
  const { data, error } = await supabase
    .from('events')
    .select('*, event_rsvps(user_id, status, waiver_accepted_at, checked_in_at)')
    .gte('starts_at', new Date().toISOString())
    .in('city', list)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return data;
}

// Places to play for the given cities. The table is the source of truth — the
// founder edits it from the moderation desk — so a new court shows up without
// an app release. Ordered the way the desk filed them: free public parks first.
export async function listCourts(cities) {
  const list = (Array.isArray(cities) ? cities : [cities]).filter(Boolean);
  if (!list.length) return [];
  const { data, error } = await supabase
    .from('courts')
    .select('id, city, name, address, sport, setting, access, courts, lights, note, sort_order')
    .in('city', list)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

// ---------- Tournaments ----------

const TOURNAMENT_SELECT =
  '*, tournament_entries(user_id, seed), tournament_matches(id, round, slot, player_a, player_b, winner, score, is_bye, reported_at)';

// Tournaments in the given cities, plus any the member has entered wherever
// they are — dropping a city in Settings mustn't strand them mid-bracket with
// no way to record a result. Each comes with its entry list and, once the draw
// has been made, every match of its bracket. Open and in-play tournaments are
// listed however long ago they started (a long one is still being played);
// finished ones stay for two weeks after the final so the result can be seen.
// The bracket is built and advanced by the database; the app only draws it.
export async function listTournaments(cities) {
  const list = (Array.isArray(cities) ? cities : [cities]).filter(Boolean);
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  // Quoted: the timestamp's colons and dots are filter syntax to PostgREST.
  const live = `status.in.(registration,in_progress),completed_at.gte."${since}"`;
  const query = () => supabase
    .from('tournaments')
    .select(TOURNAMENT_SELECT)
    .neq('status', 'cancelled')
    .or(live)
    .order('starts_at', { ascending: true });

  const byCity = list.length
    ? query().in('city', list)
    : Promise.resolve({ data: [], error: null });
  const mine = (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: [], error: null };
    const { data: entries, error } = await supabase
      .from('tournament_entries')
      .select('tournament_id')
      .eq('user_id', user.id);
    if (error) return { data: null, error };
    const ids = [...new Set((entries || []).map((e) => e.tournament_id))];
    if (!ids.length) return { data: [], error: null };
    return query().in('id', ids);
  })();

  const [cityRes, mineRes] = await Promise.all([byCity, mine]);
  if (cityRes.error) throw cityRes.error;
  if (mineRes.error) throw mineRes.error;
  const merged = new Map();
  for (const t of [...(cityRes.data || []), ...(mineRes.data || [])]) merged.set(t.id, t);
  return [...merged.values()].sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
}

export async function joinTournament(tournamentId) {
  const { error } = await supabase.rpc('join_tournament', { p_tournament: tournamentId });
  if (error) throw error;
}

export async function leaveTournament(tournamentId) {
  const { error } = await supabase.rpc('leave_tournament', { p_tournament: tournamentId });
  if (error) throw error;
}

// Either player in a match records who won. The server checks that, and
// moves the winner into the next round.
export async function reportMatchResult(matchId, winnerId, score) {
  const { error } = await supabase.rpc('report_match_result', { p_match: matchId, p_winner: winnerId, p_score: score || '' });
  if (error) throw error;
}

export async function rsvp(eventId, going) {
  const { data: { user } } = await supabase.auth.getUser();
  if (going) {
    const { error } = await supabase.from('event_rsvps').upsert({ event_id: eventId, user_id: user.id, status: 'going' });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', user.id);
    if (error) throw error;
  }
}

// ---------- Waiver, check-in and the crew ----------

// Stamps the member's own RSVP with the event waiver they just accepted. The
// RSVP has to exist first, and check-in is refused until this has been called.
export async function acceptEventWaiver(eventId) {
  const { error } = await supabase.rpc('accept_event_waiver', { p_event: eventId });
  if (error) throw error;
}

// Check in at the event with the code the host reads out. The server decides
// everything and says why in words meant to be shown: "That code isn't right.",
// "Accept the event waiver first.", "RSVP before you check in.", "Check-in
// opens an hour before the event." A member cannot mark themselves checked in
// any other way.
export async function checkInToEvent(eventId, code) {
  const { error } = await supabase.rpc('check_in_event', { p_event: eventId, p_code: code });
  if (error) throw error;
}

// The people who checked in to the same event as me — never the RSVP list.
//   → [{ user_id, first_name, event_id, event_title, event_starts_at, added,
//        also_open_to_dating }]
// also_open_to_dating is worked out by the server and is true only when it is
// mutual. The app shows it as given and never works it out for itself.
export async function fetchCrew() {
  const { data, error } = await supabase.rpc('get_my_crew');
  if (error) throw error;
  return data || [];
}

// Keep someone from an event on my crew list. Only works for a person I
// really shared a court with; the server refuses anyone else.
export async function addToCrew(userId) {
  const { error } = await supabase.rpc('crew_add', { p_member: userId });
  if (error) throw error;
}

// Take someone back off my crew list.
export async function removeFromCrew(userId) {
  const { error } = await supabase.rpc('crew_remove', { p_member: userId });
  if (error) throw error;
}

// ---------- Leagues (ladders) ----------

// Ladder leagues, soonest first. Every city's are readable; the app shows the
// ones in the member's cities.
export async function fetchLeagues() {
  const { data, error } = await supabase
    .from('leagues')
    .select('id, city, title, sport, level_range, starts_at, weeks, venue')
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Join a ladder: the newest member takes the bottom rung.
export async function joinLeague(leagueId) {
  const { error } = await supabase.rpc('join_league', { p_league: leagueId });
  if (error) throw error;
}

// Leave a ladder: everyone below moves up one, and open challenges are dropped.
export async function leaveLeague(leagueId) {
  const { error } = await supabase.rpc('leave_league', { p_league: leagueId });
  if (error) throw error;
}

// The ladder, top rung first.
//   → [{ rung, user_id, first_name, wins, losses, is_me }]
// Someone hidden from me (a block either way) keeps their rung but comes back
// with no user_id and the name "Player".
export async function fetchLeagueStandings(leagueId) {
  const { data, error } = await supabase.rpc('get_league_standings', { p_league: leagueId });
  if (error) throw error;
  return data || [];
}

// Challenge someone at most two rungs above me. Returns the challenge's id,
// which is what a result is recorded against.
export async function challengeInLeague(leagueId, targetId) {
  const { data, error } = await supabase.rpc('league_challenge', { p_league: leagueId, p_target: targetId });
  if (error) throw error;
  return data;
}

// Either player in a challenge records who won. If the challenger won, the
// server moves them up to the challenged player's rung.
export async function reportLeagueResult(challengeId, winnerId) {
  const { error } = await supabase.rpc('report_league_result', { p_challenge: challengeId, p_winner: winnerId });
  if (error) throw error;
}

// My challenges still to be played, in every ladder — the ones I made and the
// ones made against me. Row-level security returns only challenges I am one of
// the two players in. This is how a challenge made against me, or one I made
// before the app was last closed, can still have its result recorded.
export async function fetchMyLeagueChallenges() {
  const { data, error } = await supabase
    .from('league_challenges')
    .select('id, league_id, challenger_id, challenged_id')
    .is('decided_at', null);
  if (error) throw error;
  return data || [];
}

// ---------- Safety ----------

// Blocking and reporting go through functions (migration 31), not straight
// into the tables: a direct insert failed for a deleted account but worked
// for one hidden from you, which told the two apart. Both functions quietly do
// nothing for an id with no profile.
export async function blockUser(targetId) {
  const { error } = await supabase.rpc('block_member', { p_target: targetId });
  if (error) throw error;
}

export async function reportUser(targetId, reason, context = 'deck') {
  const { error } = await supabase.rpc('report_member', { p_target: targetId, p_reason: reason, p_context: context });
  if (error) throw error;
}

// ---------- Notifications ----------

export async function listNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

export async function markNotificationsRead() {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null);
  if (error) throw error;
}

// ---------- Devices ----------
// The account remembers the phones it's used on, and can sign one out.

export async function touchDevice(key, name, platform) {
  // Returns false when this device has been signed out from elsewhere.
  const { data, error } = await supabase.rpc('touch_device', {
    p_key: key, p_name: name || '', p_platform: platform || 'unknown',
  });
  if (error) throw error;
  return data === true;
}

export async function listDevices() {
  const { data, error } = await supabase
    .from('devices')
    .select('id, device_key, name, platform, first_seen_at, last_seen_at')
    .is('revoked_at', null)
    .order('last_seen_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function revokeDevice(id) {
  const { data, error } = await supabase.rpc('revoke_device', { p_id: id });
  if (error) throw error;
  return data === true;
}

// ---------- Push ----------

export async function registerPushToken(token, platform, deviceKey) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('push_tokens').upsert(
    { user_id: user.id, token, platform, device_key: deviceKey || null, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,token' }
  );
  if (error) throw error;
}

// ---------- Waitlist (also used by the landing page) ----------

export async function joinWaitlist(email, city, source = 'app') {
  const { error } = await supabase.from('waitlist').insert({ email, city, source });
  if (error && error.code !== '23505') throw error; // duplicate email is fine
}
