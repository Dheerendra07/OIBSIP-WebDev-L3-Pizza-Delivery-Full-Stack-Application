import { createServer } from 'node:http';
import mongoose from 'mongoose';
import app from './app.js';
import { config } from './config/env.js';
import { startStockAlertJob } from './jobs/stockAlerts.js';
import { startOrderNotificationJob } from './jobs/orderNotifications.js';
import { attachRealtimeServer } from './services/realtime.js';
import { ensureAdminAccount, ensureInventorySeeded } from './utils/databaseBootstrap.js';

let server;
let realtime;
let stockJob;
let orderNotificationJob;

async function start() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });

  const inventoryCount = await ensureInventorySeeded();
  console.info(`Inventory bootstrap ready: ${inventoryCount} catalog ingredients checked; existing stock preserved.`);

  const admin = await ensureAdminAccount();
  if (admin.skipped) {
    console.warn('Admin bootstrap skipped. Set ADMIN_EMAIL and ADMIN_PASSWORD to enable admin operations.');
  } else if (admin.created) {
    console.info('Initial Pizza House admin account created. Credentials were not printed.');
  } else {
    console.info('Pizza House admin account already exists; existing password was preserved.');
  }

  server = createServer(app);
  realtime = attachRealtimeServer(server);
  server.listen(config.port, () => console.info(`Pizza House API listening on port ${config.port}`));
  stockJob = startStockAlertJob();
  orderNotificationJob = startOrderNotificationJob();
}

async function shutdown(signal) {
  console.info(`${signal}: shutting down`);
  stockJob?.stop();
  orderNotificationJob?.stop();
  if (realtime) {
    await new Promise((resolve) => realtime.close(resolve));
  } else if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
  process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

start().catch((error) => {
  console.error('Server start failed:', error.message);
  process.exit(1);
});
