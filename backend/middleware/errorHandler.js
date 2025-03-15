const logger = require('../utils/logger');

/**
 * Обработчик ошибок для Express
 */
const errorHandler = (err, req, res, next) => {
  logger.error(`Ошибка запроса: ${req.method} ${req.originalUrl}`, err);
  
  // Определяем статус ошибки
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  
  res.status(statusCode).json({
    error: err.message || 'Внутренняя ошибка сервера',
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
};

module.exports = errorHandler;