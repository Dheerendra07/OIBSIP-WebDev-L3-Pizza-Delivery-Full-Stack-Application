import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../scripts/render-client-build.js', import.meta.url));
const serverDirectory = fileURLToPath(new URL('..', import.meta.url));

test('Render client build hook is inert unless explicitly enabled', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: serverDirectory,
    env: { ...process.env, BUILD_CLIENT_ON_SERVER_INSTALL: 'false' },
    encoding: 'utf8',
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || 'build hook should exit successfully');
  assert.match(result.stdout, /skipped; BUILD_CLIENT_ON_SERVER_INSTALL is not true/i);
  assert.doesNotMatch(result.stdout, /install client dependencies|build client bundle/i);
});
