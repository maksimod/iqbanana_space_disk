const fs = require('fs');
const path = require('path');

// Создаем директорию для логов, если её нет
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Пути к файлам логов
const errorLogPath = path.join(logDir, 'error.log');
const accessLogPath = path.join(logDir, 'access.log');


const debugLogPath = path.join(logDir, 'debug.log');

/**
 * Детальное логирование для отладки
 * @param {string} message - сообщение для логирования
 * @param {object} data - дополнительные данные
 */
const debug = (message, data = null) => {
  const timestamp = new Date().toISOString();
  let logMessage = `[${timestamp}] [DEBUG] ${message}`;
  
  if (data) {
    logMessage += `\nData: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}`;
  }
  
  logMessage += '\n';
  
  // Вывод в консоль
  console.debug('\x1b[35m%s\x1b[0m', logMessage);
  
  // Запись в файл
  fs.appendFile(debugLogPath, logMessage, (err) => {
    if (err) console.error(`Ошибка записи в лог отладки: ${err.message}`);
  });
};

/**
 * Логирование в файл и консоль
 * @param {string} message - сообщение для логирования
 * @param {string} level - уровень логирования (info, error, warn)
 * @param {string} filePath - путь к файлу для логирования
 */
const log = (message, level = 'info', filePath = null) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  
  // Вывод в консоль с цветом в зависимости от уровня
  switch (level) {
    case 'error':
      console.error('\x1b[31m%s\x1b[0m', logMessage);
      break;
    case 'warn':
      console.warn('\x1b[33m%s\x1b[0m', logMessage);
      break;
    case 'info':
    default:
      console.log('\x1b[36m%s\x1b[0m', logMessage);
  }
  
  // Запись в файл
  if (filePath) {
    fs.appendFile(filePath, logMessage, (err) => {
      if (err) console.error(`Ошибка записи в лог: ${err.message}`);
    });
  }
};

/**
 * Логирование информационных сообщений
 * @param {string} message - сообщение для логирования
 */
const info = (message) => {
  log(message, 'info', accessLogPath);
};

/**
 * Логирование предупреждений
 * @param {string} message - сообщение для логирования
 */
const warn = (message) => {
  log(message, 'warn', accessLogPath);
};

/**
 * Логирование ошибок
 * @param {string} message - сообщение для логирования
 * @param {Error} error - объект ошибки (опционально)
 */
const error = (message, error = null) => {
  let logMessage = message;
  
  if (error) {
    logMessage += `\nStack: ${error.stack || 'No stack trace available'}`;
  }
  
  log(logMessage, 'error', errorLogPath);
};

/**
 * Middleware для логирования HTTP запросов
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // После отправки ответа
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logMessage = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
    info(logMessage);
  });
  
  next();
};

module.exports = {
  info,
  warn,
  error,
  debug,
  requestLogger
};