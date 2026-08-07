const { stop } = require('./mongoServer');

module.exports = async function globalTeardown() {
  await stop();
};
