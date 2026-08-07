const { start } = require('./mongoServer');

module.exports = async function globalSetup() {
  process.env.MONGO_TEST_URI = await start();
};
