// Drives the real AppStateProvider (mobile/src/state.js) against the stubs in
// ./stubs, in live mode. What it proves: a message the server refuses never
// sits in the thread pretending to have been sent.
//
//   ./scripts/test-app.sh
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const TestRenderer = (() => {
  const { warn, error } = console;
  const quiet = (f) => (m, ...r) => (String(m).includes('react-test-renderer is deprecated') ? undefined : f(m, ...r));
  console.warn = quiet(warn); console.error = quiet(error);
  const tr = require('react-test-renderer');
  console.warn = warn; console.error = error;
  return tr;
})();
const { AppStateProvider, useApp, impl, alerts } = require('./.build/state.cjs');

let app = null;
function Probe() { app = useApp(); return null; }

const tick = (n = 4) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}
const thread = (id) => app.threads.find((t) => t.id === id) || { msgs: [] };
const texts = (id) => thread(id).msgs.map((m) => `${m.text || m.kind}${m.failed ? '[unsent]' : ''}`);

async function main() {
  // one match, no history
  impl.listMatches = () => [{ id: 'match-1', user_a: 'me-uuid', user_b: 'them-uuid' }];
  impl.listMessages = () => [];
  impl.getProfilesByIds = () => [{ id: 'them-uuid', name: 'Maya', birthdate: '1994-04-04', sports: ['tennis'], city: 'indianapolis' }];

  // The real trigger for a full thread refresh: a notification from them.
  let notify = null;
  impl.subscribeToNotifications = (id, cb) => { notify = cb; return () => {}; };

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(30); });

  check('live session booted with the match', app.threads.length === 1, app.threads.length);

  // 1. a send the server accepts
  await act(async () => { app.sendMessage('them-uuid', { who: 'me', text: 'hi', when: 'Just now' }); await tick(20); });
  check('accepted message stays in the thread', texts('them-uuid').join('|') === 'hi', texts('them-uuid'));
  check('accepted message is not marked unsent', !thread('them-uuid').msgs.some((m) => m.failed));

  // 2. a send the server refuses
  impl.sendTextMessage = () => { throw new Error('network'); };
  await act(async () => { app.sendMessage('them-uuid', { who: 'me', text: 'court at 10?', when: 'Just now' }); await tick(20); });
  check('refused message is marked unsent', texts('them-uuid').join('|') === 'hi|court at 10?[unsent]', texts('them-uuid'));

  // 3. it survives a full thread refresh (their reply arrives → refetch)
  impl.listMessages = () => [{ id: 'row-1', sender_id: 'me-uuid', body: 'hi', kind: 'text', sent_at: new Date().toISOString() }];
  await act(async () => { await notify({ kind: 'message', payload: { from: 'them-uuid' } }); await tick(20); });
  check('unsent message survives a thread refresh', texts('them-uuid').join('|') === 'hi|court at 10?[unsent]', texts('them-uuid'));

  // 4. retry, still failing
  await act(async () => { app.retryMessage('them-uuid', thread('them-uuid').msgs.find((m) => m.failed).localId); await tick(20); });
  check('a failed retry stays unsent (once, not twice)', texts('them-uuid').join('|') === 'hi|court at 10?[unsent]', texts('them-uuid'));

  // 5. retry once the network is back
  impl.sendTextMessage = () => ({ id: 'row-2' });
  await act(async () => { app.retryMessage('them-uuid', thread('them-uuid').msgs.find((m) => m.failed).localId); await tick(20); });
  check('a successful retry clears the unsent flag', texts('them-uuid').join('|') === 'hi|court at 10?', texts('them-uuid'));

  // 6. court proposal that fails
  impl.proposeCourtTime = () => { throw new Error('network'); };
  await act(async () => {
    app.sendMessage('them-uuid', { who: 'me', kind: 'court', court: 'Broad Ripple', day: 'Sat', time: '10:00 AM', sport: 'Tennis', when: 'Just now' });
    await tick(20);
  });
  check('refused court time is marked unsent', texts('them-uuid').join('|') === 'hi|court at 10?|court[unsent]', texts('them-uuid'));

  // 7. discard
  await act(async () => { app.discardMessage('them-uuid', thread('them-uuid').msgs.find((m) => m.failed).localId); await tick(10); });
  check('discard removes it', texts('them-uuid').join('|') === 'hi|court at 10?', texts('them-uuid'));

  // 8. no match id → still marked unsent rather than dropped
  impl.listMatches = () => { throw new Error('offline'); };
  await act(async () => { app.sendMessage('nobody-uuid', { who: 'me', text: 'stranded', when: 'Just now' }); await tick(20); });
  check('a message with no match to send to is marked unsent', texts('nobody-uuid').join('|') === 'stranded[unsent]', texts('nobody-uuid'));

  // 9. a court answer the server refuses reverts and says so
  impl.listMatches = () => [{ id: 'match-1', user_a: 'me-uuid', user_b: 'them-uuid' }];
  impl.listMessages = () => [{
    id: 'row-9', sender_id: 'them-uuid', kind: 'court_time', sent_at: new Date().toISOString(),
    court_payload: { venue: 'Broad Ripple', day: 'Sat', time: '10:00 AM', sport: 'tennis', status: 'proposed' },
  }];
  await act(async () => { await notify({ kind: 'message', payload: { from: 'them-uuid' } }); await tick(20); });
  const idx = thread('them-uuid').msgs.findIndex((m) => m.kind === 'court');
  check('their court proposal is on screen', idx >= 0, texts('them-uuid'));
  impl.respondCourtTime = () => { throw new Error('network'); };
  alerts.length = 0;
  await act(async () => { app.respondCourt('them-uuid', idx, true); await tick(20); });
  check('a refused Accept reverts to proposed', thread('them-uuid').msgs[idx].status === 'proposed', thread('them-uuid').msgs[idx].status);
  check('a refused Accept tells the member', alerts.length === 1, alerts);

  // 10. and works when the server takes it
  impl.respondCourtTime = () => ({ ok: true });
  await act(async () => { app.respondCourt('them-uuid', idx, true); await tick(20); });
  check('an accepted Accept sticks', thread('them-uuid').msgs[idx].status === 'accepted', thread('them-uuid').msgs[idx].status);

  await act(async () => { renderer.unmount(); });
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
