/**
 * Скрипт для запуска приложения в режиме разработки
 * с использованием nodemon для автоматической перезагрузки
 */
const nodemon = require('nodemon');
const logger = require('./utils/logger');
const path = require('path');

// Запускаем nodemon
nodemon({
  script: 'server.js',
  ext: 'js json',
  ignore: ['logs/*', 'node_modules/*']
});

// Логи
nodemon.on('start', () => {
  logger.info('Сервер запущен в режиме разработки');
});

nodemon.on('restart', (files) => {
  logger.info(`Сервер перезапущен из-за изменений: ${files.map(f => path.basename(f)).join(', ')}`);
});

nodemon.on('quit', () => {
  logger.info('Сервер в режиме разработки остановлен');
  process.exit();
});

nodemon.on('crash', () => {
  logger.error('Сервер в режиме разработки аварийно завершился');
});