const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const sessionsRoutes = require('./sessions.routes');
const analysisResultsRoutes = require('./analysisResults.routes');
const reportsRoutes = require('./reports.routes');
const notificationsRoutes = require('./notifications.routes');
const dspRestClient = require('../services/dspRestClient');

const router = express.Router();

router.get('/health', async (req, res) => {
  const [dspHealthy] = await Promise.all([dspRestClient.checkHealth()]);
  const mongoHealthy = mongoose.connection.readyState === 1;
  const healthy = mongoHealthy && dspHealthy;

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      mongo: mongoHealthy ? 'up' : 'down',
      dspService: dspHealthy ? 'up' : 'down',
    },
  });
});

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/sessions', sessionsRoutes);
router.use('/analysis-results', analysisResultsRoutes);
router.use('/reports', reportsRoutes);
router.use('/notifications', notificationsRoutes);

module.exports = router;
