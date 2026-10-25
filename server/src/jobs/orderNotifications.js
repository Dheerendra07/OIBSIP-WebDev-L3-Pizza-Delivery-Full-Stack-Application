import cron from 'node-cron';
import { processOrderNotificationQueue } from '../services/orderNotifications.js';

export function startOrderNotificationJob() {
  const task = cron.schedule('* * * * *', () => {
    processOrderNotificationQueue().then(result => {
      if (result.processed || result.failed || result.dead) console.info('[order notification queue]', result);
    }).catch(error => console.error('[order notification queue] worker failed', String(error?.name || 'Error').slice(0, 60)));
  });
  console.info('Order notification outbox scheduled: every minute.');
  return { stop() { task.stop(); } };
}
