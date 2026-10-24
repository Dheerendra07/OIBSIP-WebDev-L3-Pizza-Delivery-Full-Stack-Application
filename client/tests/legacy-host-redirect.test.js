import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const redirectSource = readFileSync(
  new URL('../public/legacy-host-redirect.js', import.meta.url),
  'utf8',
);

function evaluateRedirect(hostname, pathname = '/menu', search = '?category=veg', hash = '#featured') {
  const location = {
    hostname,
    pathname,
    search,
    hash,
    replacedWith: null,
    replace(destination) {
      this.replacedWith = destination;
    },
  };

  runInNewContext(redirectSource, { window: { location }, URL });
  return location.replacedWith;
}

test('legacy customer host redirects to the canonical origin and preserves navigation state', () => {
  assert.equal(
    evaluateRedirect('pizza-house-web-n75h.onrender.com', '/menu', '?category=veg', '#featured'),
    'https://pizza-house-api.onrender.com/menu?category=veg#featured',
  );
});

test('canonical host, local development, and lookalike hostnames are not redirected', () => {
  assert.equal(evaluateRedirect('pizza-house-api.onrender.com'), null);
  assert.equal(evaluateRedirect('localhost'), null);
  assert.equal(evaluateRedirect('pizza-house-web-n75h.onrender.com.attacker.example'), null);
});
