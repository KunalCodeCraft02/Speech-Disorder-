const crypto = require('crypto');
const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

// One shared in-memory mongod (started in globalSetup.js). Each test FILE
// gets its own logical database on it, keyed by a random id computed once
// when this setup module is evaluated — Jest re-requires setupFilesAfterEnv
// modules fresh per test file, so this runs once per file. Deliberately NOT
// keyed by JEST_WORKER_ID: with multiple `projects` (unit/integration/
// sockets), Jest can run separate worker pools whose worker ids overlap
// (both pools handing out "1"), which let two unrelated test files share a
// "gateway_test_1" database and race each other's afterEach cleanup.
const dbName = `gateway_test_${crypto.randomUUID()}`;

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI, { dbName });
}, 30000);

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.close();
});
