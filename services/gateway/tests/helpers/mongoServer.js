const fs = require('fs');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Reuse a locally-installed mongod if one's present (much faster than
// downloading a binary on every fresh checkout); mongodb-memory-server
// falls back to its own managed download when none of these exist, which
// is exactly what a clean CI box needs.
const SYSTEM_MONGOD_CANDIDATES = [
  'C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe',
  'C:/Program Files/MongoDB/Server/7.0/bin/mongod.exe',
  'C:/Program Files/MongoDB/Server/6.0/bin/mongod.exe',
  '/usr/bin/mongod',
  '/usr/local/bin/mongod',
];

function findSystemBinary() {
  return SYSTEM_MONGOD_CANDIDATES.find((p) => fs.existsSync(p));
}

let mongod;

// globalSetup and globalTeardown are both required from the same Jest
// main-process module cache, so this module-scoped `mongod` reference
// survives between the two calls even though they run as separate
// invocations.
async function start() {
  const systemBinary = findSystemBinary();
  mongod = await MongoMemoryServer.create(systemBinary ? { binary: { systemBinary } } : undefined);
  return mongod.getUri();
}

async function stop() {
  if (mongod) {
    await mongod.stop();
    mongod = undefined;
  }
}

module.exports = { start, stop };
