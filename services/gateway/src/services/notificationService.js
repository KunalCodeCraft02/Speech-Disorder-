const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');

async function notify({ userId, type, title, message, priority, channel, relatedSessionId, relatedReportId, expiresAt }) {
  return Notification.create({
    userId,
    type,
    title,
    message,
    priority,
    channel,
    relatedSessionId,
    relatedReportId,
    expiresAt,
  });
}

async function listForUser(userId, { read, page, limit }) {
  const filter = { userId };
  if (read !== undefined) filter.read = read;

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, read: false }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1, unreadCount };
}

async function getByIdOr404(id) {
  const notification = await Notification.findById(id);
  if (!notification) throw ApiError.notFound('Notification not found');
  return notification;
}

function assertOwner(notification, requester) {
  if (notification.userId.toString() !== requester.id) {
    throw ApiError.forbidden('You do not have access to this notification');
  }
}

async function markRead(id) {
  const notification = await getByIdOr404(id);
  if (!notification.read) {
    notification.read = true;
    notification.readAt = new Date();
    await notification.save();
  }
  return notification;
}

async function markAllRead(userId) {
  await Notification.updateMany({ userId, read: false }, { read: true, readAt: new Date() });
}

async function remove(id) {
  const notification = await getByIdOr404(id);
  await notification.deleteOne();
}

module.exports = { notify, listForUser, getByIdOr404, assertOwner, markRead, markAllRead, remove };
