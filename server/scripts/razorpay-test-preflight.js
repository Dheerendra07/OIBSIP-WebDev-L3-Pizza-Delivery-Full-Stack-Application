import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { checkRazorpayTestCredentials } from './razorpay-test-preflight-core.js';

// Load only the local server env file; real process environment variables retain precedence.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const result = await checkRazorpayTestCredentials();

for (const check of result.checks) {
  console.log(`[${check.ok ? 'PASS' : 'BLOCKED'}] ${check.label}${check.ok ? '' : `: ${check.detail}`}`);
}

if (!result.ok) {
  console.error('\nRazorpay preflight failed. Check server/.env locally; do not paste keys into chat, logs, or commits.');
  process.exitCode = 1;
} else {
  console.log('\nRazorpay Test Mode credentials authenticate successfully.');
  console.log('Safety: this used a read-only GET request and did not create an order, charge, payment, or refund.');
  console.log('Not tested: browser checkout/capture, dashboard webhook delivery, email delivery, or refund processing.');
}
