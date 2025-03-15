// server.js
const express = require('express');
const path = require('path');
const config = require('./config/config');
const corsMiddleware = require('./middleware/cors');
const errorHandler = require('./middleware/errorHandler');
const diskRoutes = require('./routes/diskRoutes');
const fileRoutes = require('./routes/fileRoutes');
const systemRoutes = require('./routes/systemRoutes');
const logger = require('./utils/logger');

// Инициализация Express приложения
const app = express();
const PORT = config.server.port;
const API_VERSION = config.apiVersion;

// Основные middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(logger.requestLogger);

// API маршруты с версионированием
app.use(`/api/${API_VERSION}/disks`, diskRoutes);
app.use(`/api/${API_VERSION}/disks`, fileRoutes);
app.use(`/api/${API_VERSION}/system`, systemRoutes);

// Обратная совместимость с предыдущей версией API
app.use('/api/disks', diskRoutes);
app.use('/api/disks', fileRoutes);
app.use('/api/system', systemRoutes);

// Обработка ошибок
app.use(errorHandler);

// Запуск сервера
app.listen(PORT, () => {
  logger.info(`Сервер запущен на порту ${PORT}`);
  logger.info(`API доступно по адресу /api/${API_VERSION}`);
  logger.info(`Доступные диски: ${Object.keys(config.disks).join(', ')}`);
});

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
  logger.error('Необработанное исключение', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Необработанное отклонение промиса', reason);
});