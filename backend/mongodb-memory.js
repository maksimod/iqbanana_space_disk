const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

async function startMongoDB() {
  mongoServer = await MongoMemoryServer.create({
    binary: {
      version: '7.0.3', // Use a compatible version for Debian 12
      skipMD5: true,
    },
  });
  const mongoUri = mongoServer.getUri();
  console.log(`MongoDB Memory Server запущен по адресу ${mongoUri}`);
  return mongoUri;
}

async function stopMongoDB() {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

module.exports = { startMongoDB, stopMongoDB };
