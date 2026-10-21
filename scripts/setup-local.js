import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { prepareLocalEnv, readLocalEnvValue, mergeLocalEnvValues } from '../server/src/utils/localEnvBootstrap.js';
import { inspectQaEnvironment } from '../server/src/utils/qaPreflight.js';

const root = process.cwd();
const templatePath = resolve(root, '.env.example');
const targetPath = resolve(root, 'server', '.env');

if (!existsSync(templatePath)) {
  console.error('Cannot find the root .env.example. Run this command from the repository root.');
  process.exit(1);
}

function isConfigured(value) {
  return typeof value === 'string' && value.trim() !== '';
}
function hasStrongPassword(value) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 72
    && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}
function isPlaceholder(value) {
  return !isConfigured(value) || /replace-with|change-this|your[-_ ]|<[^>]+>/i.test(value);
}

/** Read local terminal input; sensitive values are masked and never echoed. */
async function promptValue(label, { hidden = false } = {}) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') return '';
  process.stdout.write(`${label}: `);
  return new Promise((resolvePrompt, rejectPrompt) => {
    let value = '';
    const finish = (error) => {
      input.removeListener('data', onData);
      try { input.setRawMode(false); } catch {}
      input.pause();
      process.stdout.write('\n');
      if (error) rejectPrompt(error);
      else resolvePrompt(value.trim());
    };
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') return finish(new Error('Local setup cancelled.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0008' || char === '\u007f') {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (char >= ' ') {
          value += char;
          process.stdout.write(hidden ? '*' : char);
        }
      }
    };
    try {
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
    } catch (error) {
      rejectPrompt(error);
    }
  });
}

async function run() {
  const template = readFileSync(templatePath, 'utf8');
  const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : undefined;
  const prepared = prepareLocalEnv(template, existing);
  let content = prepared.content;

  const prompts = [
    { key: 'MONGODB_URI', label: 'MongoDB URI (local replica set or transaction-capable Atlas URI; Enter keeps current value)', hidden: true, needed: (v) => isPlaceholder(v) || /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(v || '') },
    { key: 'ADMIN_EMAIL', label: 'Admin test email (Enter skips)', hidden: false, needed: (v) => !isConfigured(v) },
    { key: 'ADMIN_PASSWORD', label: 'Admin password, 10–72 chars with uppercase/lowercase/number (masked; Enter skips)', hidden: true, needed: (v) => !hasStrongPassword(v) },
    { key: 'RESEND_API_KEY', label: 'Resend API key for HTTPS email (preferred on Render Free; sender domain must be verified; Enter skips)', hidden: true, needed: (v) => isPlaceholder(v) },
    { key: 'SMTP_HOST', label: 'SMTP host (optional fallback; Enter skips)', hidden: false, needed: (v) => isPlaceholder(v) },
    { key: 'SMTP_USER', label: 'SMTP username (masked; optional fallback; Enter skips)', hidden: true, needed: (v) => isPlaceholder(v) },
    { key: 'SMTP_PASS', label: 'SMTP password/app password (masked; optional fallback; Enter skips)', hidden: true, needed: (v) => isPlaceholder(v) },
    { key: 'MAIL_FROM', label: 'Verified sender address, e.g. Pizza House <orders@your-domain.example> (Enter skips)', hidden: false, needed: (v) => isPlaceholder(v) },
    { key: 'ADMIN_ALERT_EMAIL', label: 'Admin low-stock alert email (Enter skips)', hidden: false, needed: (v) => isPlaceholder(v) },
    { key: 'RAZORPAY_KEY_ID', label: 'Razorpay TEST MODE key ID starting rzp_test_ (masked; Enter skips)', hidden: true, needed: (v) => !/^rzp_test_[^\s]+$/.test(v || '') },
    { key: 'RAZORPAY_KEY_SECRET', label: 'Razorpay TEST MODE key secret (masked; Enter skips)', hidden: true, needed: (v) => isPlaceholder(v) },
    { key: 'RAZORPAY_WEBHOOK_SECRET', label: 'Webhook secret configured in your Razorpay dashboard (masked; Enter skips)', hidden: true, needed: (v) => isPlaceholder(v) },
  ];

  const missing = prompts.filter((item) => item.needed(readLocalEnvValue(content, item.key)));
  if (missing.length && process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    console.log('\nFill what you already have. Press Enter to skip a provider and configure it later.');
    console.log('Do not paste credentials into ChatGPT. Sensitive terminal entries are masked.');
    console.log('For Render Free, use the Resend HTTPS API rather than SMTP; email sending also requires a verified sender domain.');
    const updates = {};
    for (const item of missing) {
      const hasResendKey = isConfigured(updates.RESEND_API_KEY)
        || !isPlaceholder(readLocalEnvValue(content, 'RESEND_API_KEY'));
      if (hasResendKey && ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].includes(item.key)) continue;
      const value = await promptValue(item.label, { hidden: item.hidden });
      if (value) updates[item.key] = value;
    }
    content = mergeLocalEnvValues(content, updates);
  } else if (missing.length) {
    console.log('Interactive configuration skipped (no interactive terminal). Re-run npm run setup:local in PowerShell to fill missing values.');
  } else {
    console.log('Required local credential fields already contain values; existing settings were preserved.');
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  if (prepared.created || prepared.generatedJwtSecret || content !== existing) {
    writeFileSync(targetPath, content, { encoding: 'utf8', mode: 0o600 });
  }

  console.log(prepared.created
    ? 'Created server/.env from .env.example.'
    : prepared.generatedJwtSecret
      ? 'Kept existing settings and replaced only a missing/placeholder JWT_SECRET.'
      : 'Updated only the values you entered; all other server/.env settings were preserved.');
  if (prepared.generatedJwtSecret) console.log('Generated a strong local JWT_SECRET. Its value was not printed or uploaded.');
  console.log('\nConfiguration preflight (no credentials are shown):');
  const result = inspectQaEnvironment(Object.fromEntries(content.split(/\r?\n/).filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => {
    const separator = line.indexOf('=');
    const key = line.slice(0, separator);
    return [key, readLocalEnvValue(content, key)];
  })));
  for (const section of result.sections) {
    console.log(`\n${section.name}`);
    for (const check of section.checks) console.log(`[${check.ok ? 'PASS' : 'BLOCKED'}] ${check.label}${check.ok ? '' : `: ${check.detail}`}`);
  }
  console.log(`\nConfiguration checks: ${result.passed}/${result.total} passed.`);
  console.log('This checks value shape only. It does not connect to MongoDB, send email, call Razorpay or test the browser flow.');
  console.log('Next after config passes: npm run install:all; npm run seed:inventory; npm run seed:admin; npm run dev.');
}

run().catch((error) => {
  try { if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(false); } catch {}
  console.error(error instanceof Error ? error.message : 'Local setup failed.');
  process.exit(1);
});
