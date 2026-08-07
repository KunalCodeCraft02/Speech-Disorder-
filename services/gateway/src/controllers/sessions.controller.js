const asyncHandler = require('../utils/asyncHandler');
const sessionService = require('../services/sessionService');
const sessionManager = require('../services/sessionManager');
const { ROLES, SESSION_STATUS } = require('../utils/constants');

// REST-only session creation for clients that aren't opening a device socket
// (e.g. scheduling ahead of time, or non-realtime testing). The live audio
// flow always goes through the /device namespace's `session:start`, which
// additionally opens the DSP link — see sockets/handlers/session.handler.js.
const createSession = asyncHandler(async (req, res) => {
  const session = await sessionService.createSession(req.user.id, req.body.deviceId);
  res.status(201).json({ success: true, data: session });
});

const getSession = asyncHandler(async (req, res) => {
  const session = await sessionService.getSessionOr404(req.params.id);
  sessionService.assertCanAccess(session, req.user);
  res.status(200).json({ success: true, data: session });
});

const listSessions = asyncHandler(async (req, res) => {
  const query = { ...req.query };

  // Patients may only ever list their own sessions.
  if (req.user.role === ROLES.PATIENT) {
    query.userId = req.user.id;
  }

  const result = await sessionService.listSessions(query);
  res.status(200).json({ success: true, data: result });
});

const updateSession = asyncHandler(async (req, res) => {
  const session = await sessionService.getSessionOr404(req.params.id);
  sessionService.assertCanAccess(session, req.user);

  const { status, ...rest } = req.body;

  if (status === SESSION_STATUS.COMPLETED || status === SESSION_STATUS.ABORTED) {
    const updated = await sessionManager.endSession(req.params.id, status);
    const finalSession = updated || (await sessionService.endSession(req.params.id, status));
    if (Object.keys(rest).length) {
      Object.assign(finalSession, rest);
      await finalSession.save();
    }
    return res.status(200).json({ success: true, data: finalSession });
  }

  const updated = await sessionService.updateSession(req.params.id, rest);
  res.status(200).json({ success: true, data: updated });
});

const getMetrics = asyncHandler(async (req, res) => {
  const session = await sessionService.getSessionOr404(req.params.id);
  sessionService.assertCanAccess(session, req.user);
  const result = await sessionService.listMetrics(req.params.id, req.query);
  res.status(200).json({ success: true, data: result });
});

const getEvents = asyncHandler(async (req, res) => {
  const session = await sessionService.getSessionOr404(req.params.id);
  sessionService.assertCanAccess(session, req.user);
  const events = await sessionService.listEvents(req.params.id);
  res.status(200).json({ success: true, data: events });
});

module.exports = { createSession, getSession, listSessions, updateSession, getMetrics, getEvents };
