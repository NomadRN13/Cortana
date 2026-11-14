// mobile/src/lib/secureStorage.js, bundled for real against a fake of the
// phone's secure store (which refuses what the real one refuses: values over
// 2048 bytes and keys with characters it does not allow) and a fake of plain
// storage. What this proves:
//   - nothing about the member is ever left in plain storage;
//   - a value of any size and any characters comes back exactly;
//   - a write is all-or-nothing, and overlapping writes cannot interleave;
//   - deleting the app signs the phone out (the Keychain outlives the app);
//   - a value an older build left unencrypted is moved across and erased.
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const src = path.join(__dirname, '..', '..', 'mobile', 'src', 'lib', 'secureStorage.js');
const out = path.join(__dirname, '.build');
const file = path.join(out, 'secureStorage.cjs');
fs.mkdirSync(out, { recursive: true });

let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${ok ? '' : ' :: ' + JSON.stringify(got)}`); if (!ok) failed++; };

const FAKES = {
  'react-native': 'module.exports = { Platform: { get OS() { return globalThis.__os; } } };',
  '@react-native-async-storage/async-storage': `
    const s = () => globalThis.__plain;
    module.exports = { __esModule: true, default: {
      getItem: (k) => Promise.resolve(k in s() ? s()[k] : null),
      setItem: (k, v) => { s()[k] = v; return Promise.resolve(); },
      removeItem: (k) => { delete s()[k]; return Promise.resolve(); },
    } };`,
  'expo-secure-store': `
    const s = () => globalThis.__secure;
    const tick = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
    const okKey = (k) => { if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error('bad key ' + k); };
    module.exports = {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
      getItemAsync: async (k, o) => { okKey(k); globalThis.__opts.push(o); await tick(); return k in s() ? s()[k] : null; },
      setItemAsync: async (k, v, o) => {
        okKey(k); globalThis.__opts.push(o);
        if (typeof v !== 'string') throw new Error('not a string');
        if (Buffer.byteLength(v, 'utf8') > 2048) throw new Error('value over 2048 bytes');
        if (globalThis.__failWrites && (globalThis.__writes += 1) > 2) throw new Error('disk full');
        await tick(); s()[k] = v;
      },
      deleteItemAsync: async (k, o) => { okKey(k); globalThis.__opts.push(o); await tick(); delete s()[k]; },
    };`,
};

// A new copy of the module = a new launch of the app.
const launch = (os = 'ios') => { globalThis.__os = os; delete require.cache[require.resolve(file)]; return require(file).default; };
const install = () => { globalThis.__plain = {}; globalThis.__secure = {}; globalThis.__opts = []; globalThis.__failWrites = false; };

(async () => {
  await esbuild.build({
    entryPoints: [src], bundle: true, platform: 'node', format: 'cjs', outfile: file, logLevel: 'silent',
    plugins: [{ name: 'fakes', setup(b) {
      b.onResolve({ filter: /^(react-native|@react-native-async-storage\/async-storage|expo-secure-store)$/ }, (a) => ({ path: a.path, namespace: 'fake' }));
      b.onLoad({ filter: /.*/, namespace: 'fake' }, (a) => ({ contents: FAKES[a.path], loader: 'js' }));
    } }],
  });

  const KEY = 'sb-xobncarvzgdtnkkhsznm-auth-token';
  const session = JSON.stringify({ access_token: 'a'.repeat(3000), refresh_token: 'r'.repeat(600), user: { name: 'Zoë 🎾 Ñandú 李', note: '100% %41 \\u00e9' } });
  const plainLeak = () => Object.entries(globalThis.__plain).filter(([k]) => k !== 'rsvplay.secure.installed');

  // ---- a normal install ----
  install();
  let st = launch();
  check('nothing stored reads as absent', (await st.getItem(KEY)) === null);
  await st.setItem(KEY, session);
  check('a session larger than one secure-store value comes back exactly', (await st.getItem(KEY)) === session);
  const values = Object.values(globalThis.__secure);
  check('it is split so every stored piece fits the secure store', values.length >= 4 && values.every((v) => Buffer.byteLength(v, 'utf8') <= 2048), values.map((v) => v.length));
  check('every stored piece is plain ASCII, so a piece can never cut a character in half', values.every((v) => /^[\x00-\x7f]*$/.test(v)));
  check('nothing about the member is left in plain storage', plainLeak().length === 0, plainLeak().map(([k]) => k));
  check('every call asks for this-device-only, after-first-unlock protection',
    globalThis.__opts.length > 0 && globalThis.__opts.every((o) => o && o.keychainAccessible === 'after-first-unlock-this-device-only'), globalThis.__opts.slice(0, 2));

  // ---- the next launch of the same install ----
  st = launch();
  check('the next launch still has the session', (await st.getItem(KEY)) === session);

  // ---- overwrite, then remove ----
  await st.setItem(KEY, '{"short":true}');
  check('a shorter value replaces it', (await st.getItem(KEY)) === '{"short":true}');
  check('and leaves no pieces of the old one behind', Object.keys(globalThis.__secure).length === 2, Object.keys(globalThis.__secure));
  await st.setItem(KEY, '');
  check('an empty value is stored as empty, not as absent', (await st.getItem(KEY)) === '');
  await st.removeItem(KEY);
  check('remove erases everything', (await st.getItem(KEY)) === null && Object.keys(globalThis.__secure).length === 0, Object.keys(globalThis.__secure));

  // ---- a write that fails half way ----
  await st.setItem(KEY, session);
  const before = Object.keys(globalThis.__secure).sort().join();
  globalThis.__writes = 0;
  globalThis.__failWrites = true;   // the first two pieces land, then the phone refuses
  let threw = false;
  await st.setItem(KEY, JSON.stringify({ access_token: 'NEW'.repeat(1500) })).catch(() => { threw = true; });
  globalThis.__failWrites = false;
  check('a write that fails says so', threw);
  check('and the previous value is still whole', (await st.getItem(KEY)) === session);
  check('with none of the half-written pieces left behind', Object.keys(globalThis.__secure).sort().join() === before, Object.keys(globalThis.__secure));

  // ---- writes that overlap ----
  const many = Array.from({ length: 12 }, (_, i) => JSON.stringify({ n: i, pad: String(i).repeat(2500 + i * 300) }));
  await Promise.all(many.map((v) => st.setItem('rsvplay.profile', v)));
  check('overlapping writes land in order: the last one asked for is the one kept', (await st.getItem('rsvplay.profile')) === many[11]);
  const profilePieces = Object.keys(globalThis.__secure).filter((k) => k.startsWith('rsvplay.profile.'));
  check('with no pieces of the others mixed in', profilePieces.length === Math.ceil(many[11].length / 1800) + 1, profilePieces.length);

  // ---- two keys do not disturb each other ----
  check('another key is untouched', (await st.getItem(KEY)) === session);

  // ---- deleting the app: plain storage is wiped, the Keychain is not ----
  globalThis.__plain = {};
  st = launch();
  check('after the app is deleted and reinstalled, the phone is signed out', (await st.getItem(KEY)) === null);
  check('and what the old install left in the Keychain is erased', !Object.keys(globalThis.__secure).some((k) => k.startsWith('sb-')), Object.keys(globalThis.__secure));
  await st.setItem(KEY, session);
  check('a sign-in after the reinstall is kept', (await st.getItem(KEY)) === session);
  check('writing a key before reading it does not get it erased as a leftover', (await (async () => {
    globalThis.__plain = {}; const s2 = launch(); await s2.setItem('rsvplay.prefs', '{"radius":10}'); return s2.getItem('rsvplay.prefs');
  })()) === '{"radius":10}');

  // ---- an older build left the session unencrypted ----
  install();
  globalThis.__plain['rsvplay.secure.installed'] = '1';
  globalThis.__plain[KEY] = session;
  st = launch();
  check('a session an older build left in plain storage still signs the member in', (await st.getItem(KEY)) === session);
  check('and is moved into the secure store and erased from plain storage', plainLeak().length === 0 && Object.keys(globalThis.__secure).length > 2, plainLeak().map(([k]) => k));
  // the same on a build with no marker yet (the first run of this version)
  install();
  globalThis.__plain[KEY] = session;
  st = launch();
  check('the first run after an update keeps the member signed in', (await st.getItem(KEY)) === session && plainLeak().length === 0, plainLeak().map(([k]) => k));

  // ---- a key the secure store would refuse ----
  install();
  st = launch();
  await st.setItem('weird key/with:chars', 'v');
  check('a key with characters the secure store refuses still works', (await st.getItem('weird key/with:chars')) === 'v');

  // ---- the browser preview has no secure store ----
  install();
  st = launch('web');
  await st.setItem(KEY, session);
  check('on the web it falls back to plain storage and never touches the secure store',
    (await st.getItem(KEY)) === session && globalThis.__plain[KEY] === session && Object.keys(globalThis.__secure).length === 0);

  console.log(failed ? `\n${failed} failing` : '\nall green');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
