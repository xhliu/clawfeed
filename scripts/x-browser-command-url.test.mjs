// The ledger charges the page a browser open/navigate loads, never a CLI flag (2026-11-24: 14 rows charged "--label").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./clawfeed-x-pipeline.mjs', import.meta.url), 'utf8');
const body = src.match(/export function browserCommandUrl\(args\) \{[\s\S]*?\n\}\n/)[0].replace('export ', '');
const browserCommandUrl = new Function(`${body}; return browserCommandUrl;`)();
assert.equal(browserCommandUrl(['open', '--label', 'clawfeed-x-1', 'https://x.com/home']), 'https://x.com/home');
assert.equal(browserCommandUrl(['open', 'https://x.com/home']), 'https://x.com/home');
assert.equal(browserCommandUrl(['navigate', '--target-id=abc', 'https://x.com/search']), 'https://x.com/search');
assert.throws(() => browserCommandUrl(['open', '--label', 'x']), /without a URL/);
assert.match(src, /chargeTransportRequest\(browserCommandUrl\(args\)\)/);
assert.doesNotMatch(src, /chargeTransportRequest\(args\[1\]\)/);
console.log('browser command URL charge passed');
