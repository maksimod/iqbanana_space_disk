const cors = require('cors');
const config = require('../config/config');

// Конфигурация CORS
const corsMiddleware = cors({
  origin: config.server.allowedOrigins,
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
});

module.exports = corsMiddleware;