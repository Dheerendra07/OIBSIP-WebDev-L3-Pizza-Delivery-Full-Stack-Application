import { spawnSync } from 'node:child_process';

if (process.env.BUILD_CLIENT_ON_SERVER_INSTALL !== 'true') {
  console.log('[render client build] skipped; BUILD_CLIENT_ON_SERVER_INSTALL is not true.');
  process.exit(0);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands = [
  ['install client dependencies', ['--prefix', '../client', 'ci', '--include=dev']],
  ['build client bundle', ['--prefix', '../client', 'run', 'build']],
];

for (const [label, args] of commands) {
  console.log(`[render client build] ${label}...`);
  const result = spawnSync(npmCommand, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`[render client build] ${label} could not start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[render client build] ${label} failed with exit code ${result.status ?? 'unknown'}.`);
    process.exit(result.status || 1);
  }
}
