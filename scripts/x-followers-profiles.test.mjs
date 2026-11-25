import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { meteredEvaluate } from './x-browser-metered-evaluate.mjs';

// The list function keeps each user's bio, location, follower count and verified flag, pages the Followers
// operation when asked, reads the account's own counts once, and carries profile fields through a resume.
const source = fs.readFileSync(new URL('./clawfeed-x-pipeline.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function makeFetchFollowingListFn(');
const end = source.indexOf('\nfunction ', start + 1);
const factory = vm.runInNewContext('(' + source.slice(start, end) + ')', { X_BEARER_FALLBACK: 'fixture', FOLLOWING_QUERY_ID_FALLBACK: 'fixture' });

const user = (id, screen, extra = {}) => ({ user_results: { result: { __typename: 'User', rest_id: id, core: { screen_name: screen, name: screen.toUpperCase() },
  legacy: { description: 'bio of ' + screen, followers_count: 42, ...extra.legacy }, location: { location: 'Ohio' }, is_blue_verified: true } } });
const page = (users, bottom) => {
  const entries = [
    ...users.map((u) => ({ content: { itemContent: u } })),
    ...(bottom ? [{ content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: bottom } }] : []),
  ];
  return { data: { user: { result: { timeline: { timeline: { instructions: [{ entries }] } } } } } };
};

async function run(fn, responses) {
  const urls = [];
  const context = vm.createContext({
    Response, URL, setTimeout: (f) => f(), location: { hostname: 'x.com' },
    document: { scripts: [{ src: 'https://abs.twimg.com/responsive-web/client-web/main.abc.js' }], cookie: 'ct0=fixture; twid=u%3D123' },
    window: { fetch: async (url) => { urls.push(String(url)); return responses.shift()(String(url)); } },
  });
  const out = await meteredEvaluate({ fn, evaluate: async (code) => vm.runInContext('(' + code + ')()', context),
    guard: async () => {}, reserve: async () => {}, sleep: async () => {}, timeoutMs: 2000 });
  return { out, urls };
}

const mainJs = () => new Response('a="AAAAAAAAAAAAAAAAAAAAAfixturebearer";queryId:"FOLQ",operationName:"Followers";queryId:"OWNQ",operationName:"UserByRestId"', { status: 200 });
const { out, urls } = await run(
  factory({ pages: 5, startCursor: null, seedFollowing: [{ handle: '@seeded', screenName: 'seeded', name: 'Seeded', restId: '9', bio: 'kept bio', location: 'Here', followersCount: 7, verified: false }], operation: 'Followers', ownerLookup: true }),
  [mainJs,
    () => new Response(JSON.stringify({ data: { user: { result: { legacy: { followers_count: 12345, friends_count: 3985 } } } } }), { status: 200 }),
    () => new Response(JSON.stringify(page([user('1', 'alice'), user('2', 'bob')], 'C1')), { status: 200 }),
    () => new Response(JSON.stringify(page([], null)), { status: 200 })],
);
assert.equal(out.ok, true);
assert.equal(out.complete, true);
assert.equal(out.operation, 'Followers');
assert.deepEqual(out.owner && { f: out.owner.followersCount, g: out.owner.followingCount }, { f: 12345, g: 3985 });
assert.ok(urls.some((u) => u.includes('/FOLQ/Followers')), 'pages the Followers operation');
assert.ok(urls.some((u) => u.includes('/OWNQ/UserByRestId')), 'reads the account counts once');
const alice = out.following.find((u) => u.screenName === 'alice');
assert.deepEqual({ bio: alice.bio, location: alice.location, followersCount: alice.followersCount, verified: alice.verified }, { bio: 'bio of alice', location: 'Ohio', followersCount: 42, verified: true });
const seeded = out.following.find((u) => u.screenName === 'seeded');
assert.deepEqual({ bio: seeded.bio, location: seeded.location, followersCount: seeded.followersCount }, { bio: 'kept bio', location: 'Here', followersCount: 7 });

// Without a Followers query id the pass refuses instead of paging the wrong operation.
const { out: noQ } = await run(factory({ pages: 2, operation: 'Followers' }), [() => new Response('nothing', { status: 200 })]);
assert.equal(noQ.ok, false);
assert.equal(noQ.error, 'missing_query_id_Followers');

// The default stays the Following operation with its fallback id and no owner lookup.
const { out: fol, urls: furls } = await run(factory({ pages: 2 }), [() => new Response('nothing', { status: 200 }), () => new Response(JSON.stringify(page([user('3', 'carol')], null)), { status: 200 })]);
assert.equal(fol.ok, true);
assert.equal(fol.operation, 'Following');
assert.ok(furls.some((u) => u.includes('/fixture/Following')));
assert.equal(furls.some((u) => u.includes('UserByRestId')), false);
assert.equal(fol.following[0].bio, 'bio of carol');
console.log('followers-profiles: profile fields kept, Followers operation paged, account counts read once, Following default unchanged');
