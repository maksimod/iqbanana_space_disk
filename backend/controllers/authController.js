const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

// Путь к файлу с пользователями
const usersFilePath = path.join(__dirname, '../models/users.json');

// Генерация токена
const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Хеширование пароля
const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

// Чтение файла пользователей
const readUsersFile = () => {
  try {
    if (!fs.existsSync(usersFilePath)) {
      // Если файл не существует, создаем его
      const initialData = { approvedUsers: ["admin", "user1", "user2"], users: [] };
      fs.writeFileSync(usersFilePath, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    
    const data = fs.readFileSync(usersFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Ошибка чтения файла пользователей: ${error.message}`);
    return { approvedUsers: [], users: [] };
  }
};

// Сохранение файла пользователей
const saveUsersFile = (data) => {
  try {
    fs.writeFileSync(usersFilePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    logger.error(`Ошибка сохранения файла пользователей: ${error.message}`);
    return false;
  }
};

// Регистрация нового пользователя
exports.register = (req, res) => {
  try {
    const { username, password } = req.body;
    
    logger.info(`Попытка регистрации пользователя: ${username}`);
    
    if (!username || !password) {
      logger.error('Ошибка регистрации: Не указаны имя пользователя или пароль');
      return res.status(400).json({
        success: false,
        message: 'Необходимо указать имя пользователя и пароль'
      });
    }
    
    const userData = readUsersFile();
    
    // Проверяем, находится ли пользователь в списке разрешенных
    if (!userData.approvedUsers.includes(username)) {
      logger.error(`Ошибка регистрации: Пользователь ${username} не находится в списке разрешенных`);
      return res.status(403).json({
        success: false,
        message: 'Регистрация запрещена: пользователь не находится в списке разрешенных'
      });
    }
    
    // Проверяем, существует ли уже такой пользователь
    if (userData.users.some(user => user.username === username)) {
      logger.error(`Ошибка регистрации: Пользователь ${username} уже существует`);
      return res.status(409).json({
        success: false,
        message: 'Пользователь с таким именем уже существует'
      });
    }
    
    // Создаем нового пользователя
    const token = generateToken();
    const hashedPassword = hashPassword(password);
    
    const newUser = {
      id: userData.users.length + 1,
      username,
      password: hashedPassword,
      token,
      created: new Date().toISOString()
    };
    
    // Добавляем пользователя и сохраняем файл
    userData.users.push(newUser);
    const saved = saveUsersFile(userData);
    
    if (!saved) {
      logger.error(`Ошибка регистрации: Не удалось сохранить данные пользователя ${username}`);
      return res.status(500).json({
        success: false,
        message: 'Не удалось сохранить данные пользователя'
      });
    }
    
    // Отправляем ответ с токеном (без пароля)
    const { password: _, ...userWithoutPassword } = newUser;
    
    logger.info(`Успешная регистрация пользователя: ${username}`);
    
    return res.status(201).json({
      success: true,
      message: 'Пользователь успешно зарегистрирован',
      user: userWithoutPassword
    });
  } catch (error) {
    logger.error(`Ошибка при регистрации: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Внутренняя ошибка сервера'
    });
  }
};

// Вход в систему
exports.login = (req, res) => {
  try {
    const { username, password } = req.body;
    
    logger.info(`Попытка входа пользователя: ${username}`);
    
    if (!username || !password) {
      logger.error('Ошибка входа: Не указаны имя пользователя или пароль');
      return res.status(400).json({
        success: false,
        message: 'Необходимо указать имя пользователя и пароль'
      });
    }
    
    const userData = readUsersFile();
    logger.info(`Зарегистрированные пользователи: ${userData.users.map(u => u.username).join(', ') || 'нет'}`);
    
    const hashedPassword = hashPassword(password);
    
    // Ищем пользователя
    const user = userData.users.find(u => 
      u.username === username && u.password === hashedPassword
    );
    
    if (!user) {
      logger.error(`Ошибка входа: Неверные учетные данные для пользователя ${username}`);
      return res.status(401).json({
        success: false,
        message: 'Неверное имя пользователя или пароль'
      });
    }
    
    // Обновляем токен
    const newToken = generateToken();
    user.token = newToken;
    const saved = saveUsersFile(userData);
    
    if (!saved) {
      logger.error(`Ошибка входа: Не удалось обновить токен для пользователя ${username}`);
      return res.status(500).json({
        success: false,
        message: 'Не удалось обновить данные пользователя'
      });
    }
    
    // Отправляем ответ с токеном (без пароля)
    const { password: _, ...userWithoutPassword } = user;
    
    logger.info(`Успешный вход пользователя: ${username}`);
    
    return res.status(200).json({
      success: true,
      message: 'Успешный вход в систему',
      user: userWithoutPassword
    });
  } catch (error) {
    logger.error(`Ошибка при входе: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Внутренняя ошибка сервера'
    });
  }
};

// Проверка статуса аутентификации
exports.checkAuth = (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Токен не предоставлен'
      });
    }
    
    const userData = readUsersFile();
    const user = userData.users.find(u => u.token === token);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Недействительный токен'
      });
    }
    
    // Отправляем данные пользователя (без пароля)
    const { password: _, ...userWithoutPassword } = user;
    
    return res.status(200).json({
      success: true,
      message: 'Пользователь аутентифицирован',
      user: userWithoutPassword
    });
  } catch (error) {
    logger.error(`Ошибка при проверке аутентификации: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Внутренняя ошибка сервера'
    });
  }
};

// Выход из системы
exports.logout = (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Токен не предоставлен'
      });
    }
    
    const userData = readUsersFile();
    const userIndex = userData.users.findIndex(u => u.token === token);
    
    if (userIndex === -1) {
      return res.status(401).json({
        success: false,
        message: 'Недействительный токен'
      });
    }
    
    // Сбрасываем токен
    userData.users[userIndex].token = null;
    saveUsersFile(userData);
    
    return res.status(200).json({
      success: true,
      message: 'Успешный выход из системы'
    });
  } catch (error) {
    logger.error(`Ошибка при выходе: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Внутренняя ошибка сервера'
    });
  }
}; 