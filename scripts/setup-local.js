import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { prepareLocalEnv } from '../server/src/utils/localEnvBootstrap.js';

const root = process.cwd();
const templatePath = resolve(root, '.env.example');
const targetPath = resolve(root, 'server', '.env');

if (!existsSync(templatePath)) {
  console.error('Cannot find the root .env.example. Run this command from the repository root.');
  process.exit(1);
}

try {
  const template = readFileSync(templatePath, 'utf8');
  const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : undefined;
  const prepared = prepareLocalEnv(template, existing);

  mkdirSync(dirname(targetPath), { recursive: true });
  if (prepared.created || prepared.generatedJwtSecret || !existsSync(targetPath)) {
    writeFileSync(targetPath, prepared.content, { encoding: 'utf8', mode: 0o600 });
  }

  console.log(prepared.created
    ? 'Created server/.env from .env.example.'
    : prepared.generatedJwtSecret
      ? 'Kept your existing server/.env settings and replaced only its missing/placeholder JWT_SECRET.'
      : 'server/.env already exists; existing settings and JWT_SECRET were preserved.');
  if (prepared.generatedJwtSecret) console.log('Generated a strong local JWT_SECRET. Its value was not printed or uploaded.');
  console.log('Provider credentials are not generated automatically: add your SMTP settings and Razorpay TEST MODE keys locally when ready.');
  console.log('Next: review server/.env, then run npm --prefix server run qa:preflight. Preflight checks configuration only; it does not test connectivity.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local setup failed.');
  process.exit(1);
}
