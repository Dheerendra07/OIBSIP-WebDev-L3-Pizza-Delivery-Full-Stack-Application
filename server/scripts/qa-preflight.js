import 'dotenv/config';
import { inspectQaEnvironment } from '../src/utils/qaPreflight.js';

const result = inspectQaEnvironment();

for (const section of result.sections) {
  console.log(`\n${section.name}`);
  for (const check of section.checks) {
    console.log(`[${check.ok ? 'PASS' : 'BLOCKED'}] ${check.label}${check.ok ? '' : `: ${check.detail}`}`);
  }
}

console.log(`\nConfiguration checks: ${result.passed}/${result.total} passed.`);

if (!result.ok) {
  console.error('QA preflight failed. Update server/.env and re-run: npm --prefix server run qa:preflight');
  process.exitCode = 1;
} else {
  console.log('Configuration preflight passed. Database reachability, SMTP delivery, Razorpay events and browser journeys are NOT tested by this command.');
}
