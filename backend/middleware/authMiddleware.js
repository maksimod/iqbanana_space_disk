const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Путь к файлу с пользователями
const usersFilePath = path.join(__dirname, '../models/users.json');

// Чтение файла пользователей
const readUsersFile = () => {
  try {
    if (!fs.existsSync(usersFilePath)) {
      return { approvedUsers: [], users: [] };
    }
    
    const data = fs.readFileSync(usersFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Ошибка чтения файла пользователей: ${error.message}`);
    return { approvedUsers: [], users: [] };
  }
};

/**
 * Middleware для проверки аутентификации
 * Проверяет наличие и валидность токена в заголовке Authorization
 */
const authMiddleware = (req, res, next) => {
  try {
    // Получаем токен из заголовка или URL параметра
    const authHeader = req.headers.authorization;
    const urlToken = req.query.auth_token;
    
    logger.info(`Проверка аутентификации для запроса: ${req.method} ${req.originalUrl}`);
    
    // Проверяем наличие токена в заголовке или URL
    if (!authHeader && !urlToken) {
      logger.error('Ошибка аутентификации: Отсутствует токен в заголовке и в URL');
      return res.status(401).json({
        success: false,
        message: 'Необходима аутентификация'
      });
    }
    
    // Извлекаем токен из заголовка или берем из URL
    let token;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
      logger.info('Токен получен из заголовка Authorization');
    } else if (urlToken) {
      token = urlToken;
      logger.info('Токен получен из URL параметра');
    } else {
      logger.error('Ошибка аутентификации: Неверный формат токена в заголовке');
      return res.status(401).json({
        success: false,
        message: 'Необходима аутентификация'
      });
    }
    
    // Проверяем токен
    const userData = readUsersFile();
    const user = userData.users.find(u => u.token === token);
    
    if (!user) {
      logger.error(`Ошибка аутентификации: Недействительный токен [${token.substr(0, 10)}...]`);
      return res.status(401).json({
        success: false,
        message: 'Недействительный токен аутентификации'
      });
    }
    
    // Добавляем информацию о пользователе в request
    req.user = {
      id: user.id,
      username: user.username,
      isAdmin: user.username === 'admin'
    };
    
    logger.info(`Успешная аутентификация пользователя: ${user.username}${req.user.isAdmin ? ' (администратор)' : ''}`);
    
    next();
  } catch (error) {
    logger.error(`Ошибка аутентификации: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Внутренняя ошибка сервера'
    });
  }
};

module.exports = authMiddleware; 