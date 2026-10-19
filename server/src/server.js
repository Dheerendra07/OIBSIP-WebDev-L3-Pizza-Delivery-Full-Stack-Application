import mongoose from 'mongoose';
import app from './app.js';
import { config } from './config/env.js';
import { startStockAlertJob } from './jobs/stockAlerts.js';

let server; let stockJob;
async function start() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  server = app.listen(config.port, () => console.info(`Pizza House API listening on port ${config.port}`));
  stockJob = startStockAlertJob();
}
async function shutdown(signal) {
  console.info(`${signal}: shutting down`); stockJob?.stop();
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect(); process.exit(0);
}
process.once('SIGTERM', () => shutdown('SIGTERM')); process.once('SIGINT', () => shutdown('SIGINT'));
start().catch((error) => { console.error('Server start failed:', error.message); process.exit(1); });
