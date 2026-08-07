const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/authService');

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  res.status(201).json({ success: true, data: result });
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.status(200).json({ success: true, data: result });
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken);
  res.status(200).json({ success: true, data: result });
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.id, req.body.refreshToken);
  res.status(204).send();
});

module.exports = { register, login, refresh, logout };
