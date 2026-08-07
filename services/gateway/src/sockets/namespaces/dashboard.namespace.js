const socketAuth = require('../socketAuth');
const registerDashboardHandlers = require('../handlers/dashboard.handler');
const logger = require('../../config/logger');
const { SOCKET_NAMESPACES } = require('../../utils/constants');

function mountDashboardNamespace(io) {
  const nsp = io.of(SOCKET_NAMESPACES.DASHBOARD);
  nsp.use(socketAuth);

  nsp.on('connection', (socket) => {
    logger.info('Dashboard connected', { socketId: socket.id, userId: socket.user.id });
    registerDashboardHandlers(socket);
  });

  return nsp;
}

module.exports = mountDashboardNamespace;
