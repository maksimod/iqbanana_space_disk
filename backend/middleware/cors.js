const cors = require('cors');
const config = require('../config/config');

// Конфигурация CORS
const corsMiddleware = cors({
  origin: config.server.allowedOrigins,
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

module.exports = corsMiddleware;