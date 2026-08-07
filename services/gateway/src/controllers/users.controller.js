const asyncHandler = require('../utils/asyncHandler');
const userService = require('../services/userService');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');

const getMe = asyncHandler(async (req, res) => {
  const user = await userService.getById(req.user.id);
  res.status(200).json({ success: true, data: user.toSafeJSON() });
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await userService.updateMe(req.user.id, req.body);
  res.status(200).json({ success: true, data: user.toSafeJSON() });
});

function assertCalibrationAccess(req) {
  const isSelf = req.params.id === req.user.id;
  const isPrivileged = req.user.role === ROLES.CLINICIAN || req.user.role === ROLES.ADMIN;
  if (!isSelf && !isPrivileged) {
    throw ApiError.forbidden('You do not have access to this calibration profile');
  }
}

const getCalibration = asyncHandler(async (req, res) => {
  assertCalibrationAccess(req);
  const profile = await userService.getCalibration(req.params.id);
  res.status(200).json({ success: true, data: profile });
});

const putCalibration = asyncHandler(async (req, res) => {
  assertCalibrationAccess(req);
  const profile = await userService.upsertCalibration(req.params.id, req.body);
  res.status(200).json({ success: true, data: profile });
});

// Runs the audio-driven "read this passage for 30s" calibration flow —
// distinct from putCalibration's direct/manual value override above.
const recordCalibration = asyncHandler(async (req, res) => {
  assertCalibrationAccess(req);
  const profile = await userService.recordCalibration(req.params.id, req.body);
  res.status(200).json({ success: true, data: profile });
});

module.exports = { getMe, updateMe, getCalibration, putCalibration, recordCalibration };
