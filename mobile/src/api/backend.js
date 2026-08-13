// The complete API surface between the app and Supabase. Each function maps
// to the schema in supabase/migrations/ (verified by the SQL test harness).
// src/state.js swaps its demo actions for these once the backend is live —
// the function signatures mirror the state actions on purpose.
import { supabase } from '../lib/supabase';

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
  const { error } = await supabase.rpc('delete_account');
  if (error) throw error;
  await supabase.auth.signOut();
}

// ---------- Profile ----------

export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*, user_sports(*)')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProfilesByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('*, user_sports(*)')
    .in('id', ids);
  if (error) throw error;
  return data;
}

// Partial profile update (prefs, bio, activity ping) — only the given fields.
export async function updateMyProfile(fields) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('profiles').update(fields).eq('id', user.id);
  if (error) throw error;
}

export async function upsertMyProfile({ firstName, birthdate, bio, approxLat, approxLng, availabilityNote, modes, radiusMi, ageMin, ageMax, sameSportsOnly, gender, seeking, playGames, playPref, friendsPref }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    first_name: firstName,
    birthdate,
    bio: bio ?? '',
    // Privacy: round before sending — exact coordinates never leave the phone.
    approx_lat: approxLat != null ? Math.round(approxLat * 100) / 100 : null,
    approx_lng: approxLng != null ? Math.round(approxLng * 100) / 100 : null,
    availability_note: availabilityNote ?? '',
    modes,
    radius_mi: radiusMi,
    age_min: ageMin,
    age_max: ageMax,
    same_sports_only: sameSportsOnly,
    gender: gender || null,
    seeking: seeking || [],
    play_games: playGames && playGames.length ? playGames : ['singles', 'doubles', 'mixed_doubles'],
    play_pref: playPref || 'everyone',
    friends_pref: friendsPref || 'everyone',
    last_active_at: new Date().toISOString(),
  });
  if (error) throw error;
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

export async function uploadProfilePhoto(localUri, position = 0) {
  const { data: { user } } = await supabase.auth.getUser();
  // Unique filename per upload: positions can be reordered, so the path
  // must never be derived from the slot (or a replace could clobber a
  // different slot's file).
  const path = `${user.id}/${Date.now()}.jpg`;
  // Read via expo-file-system: RN's fetch is unreliable for file:// bodies (QA B-09).
  const FileSystem = require('expo-file-system');
  const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { error: upErr } = await supabase.storage.from('photos').upload(path, bytes.buffer, {
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
// RLS already filters to approved-or-own, but we filter explicitly anyway.
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
  return data; // [{ user_id, first_name, age, distance_mi, sports, verified, availability_note, bio, is_new, score }]
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

export async function listEvents(city = 'Indianapolis') {
  const { data, error } = await supabase
    .from('events')
    .select('*, event_rsvps(user_id, status)')
    .eq('city', city)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return data;
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

// ---------- Safety ----------

export async function blockUser(targetId) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('blocks').insert({ blocker_id: user.id, blocked_id: targetId });
  if (error) throw error;
}

export async function reportUser(targetId, reason, context = 'deck') {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('reports').insert({ reporter_id: user.id, target_id: targetId, reason, context });
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

// ---------- Push ----------

export async function registerPushToken(token, platform) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('push_tokens').upsert(
    { user_id: user.id, token, platform, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,token' }
  );
  if (error) throw error;
}

// ---------- Waitlist (also used by the landing page) ----------

export async function joinWaitlist(email, city = 'Indianapolis', source = 'app') {
  const { error } = await supabase.from('waitlist').insert({ email, city, source });
  if (error && error.code !== '23505') throw error; // duplicate email is fine
}
