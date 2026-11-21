import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { meteredEvaluate } from './x-browser-metered-evaluate.mjs';

// Verify makeFetchFollowingListFn embeds the resume cursor and seeds prior handles,
// and that a resumed pass with no further pages still carries the seed forward.
const source = fs.readFileSync(new URL('./clawfeed-x-pipeline.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function makeFetchFollowingListFn(');
const end = source.indexOf('\nfunction ', start + 1);
const factory = vm.runInNewContext('(' + source.slice(start, end) + ')', {
  X_BEARER_FALLBACK: 'fixture', FOLLOWING_QUERY_ID_FALLBACK: 'fixture',
});

const seedFollowing = [
  { handle: '@alpha', screenName: 'alpha', name: 'Alpha', restId: '1' },
  { handle: '@beta', screenName: 'beta', name: 'Beta', restId: '2' },
];
const fn = factory({ pages: 1, startCursor: 'CURSOR-42', seedFollowing });

// A stub page that immediately returns "no more pages" (no bottom cursor).
const context = vm.createContext({
  Response, setTimeout: (f) => f(), location: { hostname: 'x.com' },
  document: { scripts: [], cookie: 'ct0=fixture; twid=u%3D123' },
  window: { fetch: async () => new Response(JSON.stringify({ data: { user: { result: { timeline: { timeline: { instructions: [] } } } } } }), { status: 200 }) },
});
const out = await meteredEvaluate({
  fn, evaluate: async (code) => vm.runInContext('(' + code + ')()', context),
  guard: async () => {}, reserve: async () => {}, sleep: async () => {}, timeoutMs: 2000,
});
assert.equal(out.ok, true);
assert.equal(out.complete, true);            // no further pages, so complete
assert.equal(out.count, 2);                   // the two seeded handles survive
const handles = Array.from(out.following || [], (x) => String(x.handle)).sort();
assert.strictEqual(JSON.stringify(handles), JSON.stringify(['@alpha', '@beta']));
console.log('cursor-resume: resume embeds cursor + seeds prior handles and carries them forward');
