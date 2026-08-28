// Bundles mobile/src/state.js for Node, swapping the native modules for the
// stubs in ./stubs. The point is to run the REAL state layer — the file the
// app ships — not a copy of its logic.
//
//   node tests/app/build.mjs   → tests/app/.build/state.cjs
//
// It lives outside mobile/ on purpose: a nested node_modules inside the Expo
// project confuses Metro's module map and gets uploaded to EAS builds.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', '..', 'mobile', 'src');
const stubs = path.join(here, 'stubs');
const out = path.join(here, '.build');

const byPackage = {
  'react-native': path.join(stubs, 'react-native.js'),
  '@react-native-async-storage/async-storage': path.join(stubs, 'async-storage.js'),
};
const byBasename = {
  supabase: path.join(stubs, 'supabase.js'),
  socialAuth: path.join(stubs, 'native.js'),
  device: path.join(stubs, 'native.js'),
  push: path.join(stubs, 'native.js'),
  location: path.join(stubs, 'native.js'),
  backend: 'api-stub',            // generated below
};

// The backend stub is generated from whatever state.js actually calls, so a new
// api.something() doesn't quietly break the build — it just gets a stub too.
const stateSrc = fs.readFileSync(path.join(src, 'state.js'), 'utf8');
const names = [...new Set([...stateSrc.matchAll(/\bapi\.([a-zA-Z_]+)/g)].map((m) => m[1]))].sort();
const SUBSCRIPTIONS = ['subscribeToMessages', 'subscribeToNotifications'];
const apiStub = `
export const impl = {};
export const calls = [];
const ARRAYS = new Set(['listMatches','listMessages','listNotifications','listEvents','listMyPhotos','listDevices','fetchDeck','getProfilesByIds']);
function call(name, args) {
  calls.push({ name, args });
  if (impl[name]) return Promise.resolve().then(() => impl[name](...args));
  if (ARRAYS.has(name)) return Promise.resolve([]);
  if (name === 'getApprovedPhotoMap') return Promise.resolve({});
  // The device is still allowed by default — returning null here signs the
  // harness straight back out, which is a confusing way to fail a test.
  if (name === 'touchDevice') return Promise.resolve(true);
  return Promise.resolve(null);
}
${names.map((n) => (SUBSCRIPTIONS.includes(n)
    ? `export const ${n} = (...a) => { calls.push({ name: '${n}', args: a }); return impl['${n}'] ? impl['${n}'](...a) : () => {}; };`
    : `export const ${n} = (...a) => call('${n}', a);`)).join('\n')}
`;

const entry = `
export { AppStateProvider, useApp } from ${JSON.stringify(path.join(src, 'state.js'))};
export { impl, calls } from './api/backend.js';
export { alerts } from 'react-native';
export { reset as resetStorage } from '@react-native-async-storage/async-storage';
`;

const swap = {
  name: 'swap-native',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (a) => {
      if (a.path === 'test-entry') return { path: 'test-entry', namespace: 'gen' };
      if (byPackage[a.path]) return { path: byPackage[a.path] };
      if (!a.path.startsWith('.')) return null;
      const target = byBasename[path.basename(a.path, '.js')];
      if (target === 'api-stub') return { path: 'api-stub', namespace: 'gen' };
      if (target) return { path: target };
      // Relative imports inside the generated entry resolve against src/.
      if (a.namespace === 'gen') return { path: path.resolve(src, a.path) };
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: 'gen' }, (a) => ({
      contents: a.path === 'api-stub' ? apiStub : entry,
      resolveDir: src,
      loader: 'js',
    }));
  },
};

fs.mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: [{ in: 'test-entry', out: 'state' }],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outdir: out,
  outExtension: { '.js': '.cjs' },
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  plugins: [swap],
});
console.log(`built ${path.relative(process.cwd(), path.join(out, 'state.cjs'))} (${names.length} backend calls stubbed)`);
