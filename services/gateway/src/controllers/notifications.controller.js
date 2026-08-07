const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notificationService');

const listMyNotifications = asyncHandler(async (req, res) => {
  const result = await notificationService.listForUser(req.user.id, req.query);
  res.status(200).json({ success: true, data: result });
});

// Clinician/admin-only: send a direct notification to a given user (e.g. a message or reminder).
const createNotification = asyncHandler(async (req, res) => {
  const notification = await notificationService.notify(req.body);
  res.status(201).json({ success: true, data: notification });
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.getByIdOr404(req.params.id);
  notificationService.assertOwner(notification, req.user);
  const updated = await notificationService.markRead(req.params.id);
  res.status(200).json({ success: true, data: updated });
});

const markAllRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.user.id);
  res.status(204).send();
});

const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await notificationService.getByIdOr404(req.params.id);
  notificationService.assertOwner(notification, req.user);
  await notificationService.remove(req.params.id);
  res.status(204).send();
});

module.exports = { listMyNotifications, createNotification, markRead, markAllRead, deleteNotification };
