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

const fs = require('fs');
const { exec } = require('child_process');

// Функция для проверки доступности дисков
const checkDisksAvailability = () => {
  Object.entries(config.disks).forEach(([name, mountPoint]) => {
    try {
      // Проверка существования точки монтирования
      if (fs.existsSync(mountPoint)) {
        // Проверка, что это действительно подключенный диск
        exec(`df "${mountPoint}" | grep "${mountPoint}"`, (err, stdout) => {
          if (err || !stdout) {
            logger.error(`Диск ${name} (${mountPoint}) существует, но не смонтирован или недоступен`);
          } else {
            logger.info(`Диск ${name} успешно смонтирован в ${mountPoint}`);
            
            // Пробуем получить информацию о файлах
            fs.readdir(mountPoint, (readErr, files) => {
              if (readErr) {
                logger.error(`Нет доступа к файлам диска ${name} (${mountPoint}): ${readErr.message}`);
              } else {
                logger.info(`Доступно ${files.length} файлов на диске ${name} (${mountPoint})`);
              }
            });
          }
        });
      } else {
        logger.error(`Точка монтирования для диска ${name} (${mountPoint}) не существует`);
      }
    } catch (error) {
      logger.error(`Ошибка при проверке диска ${name} (${mountPoint})`, error);
    }
  });
};

// Запуск сервера
app.listen(PORT, () => {
  logger.info(`Сервер запущен на порту ${PORT}`);
  logger.info(`API доступно по адресу /api/${API_VERSION}`);
  logger.info(`Доступные диски: ${Object.keys(config.disks).join(', ')}`);

  checkDisksAvailability();
});

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
  logger.error('Необработанное исключение', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Необработанное отклонение промиса', reason);
});