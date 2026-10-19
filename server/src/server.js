import { createServer } from 'node:http';
import mongoose from 'mongoose';
import app from './app.js';
import { config } from './config/env.js';
import { startStockAlertJob } from './jobs/stockAlerts.js';
import { attachRealtimeServer } from './services/realtime.js';

let server;
let realtime;
let stockJob;

async function start() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  server = createServer(app);
  realtime = attachRealtimeServer(server);
  server.listen(config.port, () => console.info(`Pizza House API listening on port ${config.port}`));
  stockJob = startStockAlertJob();
}

async function shutdown(signal) {
  console.info(`${signal}: shutting down`);
  stockJob?.stop();
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
