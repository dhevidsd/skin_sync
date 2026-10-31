// Notification business logic.
const config = require('./config');
const log = require('./logger');
const repo = require('./repository');
const rules = require('./rules');
const { withTransaction } = require('./db');
const { AppError } = require('./errors');

// Mock email provider: just takes some time.
async function sendEmail(email) {
  await new Promise((r) => setTimeout(r, config.emailLatencyMs));
  log.info('mock email sent', { recipient: email.recipient, subject: email.subject });
}

// Handles one order.confirmed message exactly once per messageId. The dedupe row and the
// notification are written in one transaction, so a crash leaves neither and the redelivery retries.
async function handleOrderConfirmed(messageId, event) {
  if (!messageId) throw new AppError(422, 'INVALID_EVENT', 'Message has no messageId');
  const email = rules.buildOrderConfirmedEmail(event);
  return withTransaction(async (client) => {
    if (!(await repo.markProcessed(client, messageId, event.eventType))) {
      log.info('duplicate message ignored', { messageId, orderId: email.orderId });
      return null;
    }
    await sendEmail(email);
    const notification = await repo.insertNotification(client, { ...email, messageId });
    log.info('notification stored', { messageId, orderId: email.orderId, notificationId: notification.id });
    return notification;
  });
}

function listNotifications(filters) {
  return repo.listNotifications(filters);
}

async function getNotification(id) {
  const notification = await repo.findNotification(id);
  if (!notification) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', `Notification ${id} not found`, { id });
  return notification;
}

module.exports = { handleOrderConfirmed, listNotifications, getNotification };
