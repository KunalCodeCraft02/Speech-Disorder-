const socketAuth = require('../socketAuth');
const registerSessionHandlers = require('../handlers/session.handler');
const registerAudioHandlers = require('../handlers/audio.handler');
const logger = require('../../config/logger');
const { SOCKET_NAMESPACES } = require('../../utils/constants');

function mountDeviceNamespace(io) {
  const nsp = io.of(SOCKET_NAMESPACES.DEVICE);
  nsp.use(socketAuth);

  nsp.on('connection', (socket) => {
    logger.info('Device connected', { socketId: socket.id, userId: socket.user.id });
    socket.data.sessionId = null;

    registerSessionHandlers(socket);
    registerAudioHandlers(socket);
  });

  return nsp;
}

module.exports = mountDeviceNamespace;
