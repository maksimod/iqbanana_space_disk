const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const yaml = require('js-yaml');
const config = require('../config/config');
const { Disk } = require('../models');

// Путь к файлу с статусами бэкапов
const BACKUPS_YML_PATH = path.join(__dirname, '../../monitor/backups.yml');

/**
 * Проверка API-ключа для бэкапа
 */
const checkBackupApiKey = (req, res, next) => {
  // Проверяем, задан ли ключ в конфигурации
  logger.info(`[BACKUP] Загружен API ключ из конфигурации: '${config.backupApiKey}'`);
  logger.info(`[BACKUP] Получен API ключ из запроса: '${req.headers['x-api-key']}'`);

  if (!config.backupApiKey) {
    logger.error('КРИТИЧЕСКАЯ ОШИБКА: BACKUP_API_KEY не задан в .env файле');
    return res.status(500).json({ 
      error: 'Ошибка сервера: API ключ для бэкапа не настроен' 
    });
  }
  
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== config.backupApiKey) {
    logger.error(`[BACKUP] Ошибка авторизации. Полученный ключ: '${apiKey}', ожидаемый ключ: '${config.backupApiKey}'`);
    return res.status(401).json({ 
      error: 'Неавторизованный запрос, проверьте API ключ' 
    });
  }
  
  logger.info('[BACKUP] API ключ успешно проверен');
  next();
};

/**
 * Обновление статуса бэкапа
 */
const updateBackupStatus = async (req, res) => {
  try {
    const { diskName, status, message } = req.body;
    
    // Проверяем наличие обязательных параметров
    if (!diskName || !status) {
      return res.status(400).json({ 
        error: 'Необходимые параметры: diskName, status' 
      });
    }
    
    // Проверяем корректность статуса
    const validStatuses = ['PROCESSING', 'SUCCESS', 'ERROR'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Недопустимый статус. Разрешенные статусы: PROCESSING, SUCCESS, ERROR' 
      });
    }
    
    // Ищем диск в базе данных
    const disk = await Disk.findOne({ name: diskName });
    
    if (!disk) {
      return res.status(404).json({ 
        error: `Диск с именем ${diskName} не найден` 
      });
    }
    
    // Обновляем статус бэкапа
    disk.backupStatus = status;
    disk.backupMessage = message || '';
    disk.backupUpdatedAt = new Date();
    
    // Сохраняем изменения
    await disk.save();
    
    return res.status(200).json({ 
      success: true, 
      message: `Статус бэкапа диска ${diskName} обновлен на ${status}` 
    });
  } catch (error) {
    console.error('Ошибка при обновлении статуса бэкапа:', error);
    return res.status(500).json({ 
      error: 'Внутренняя ошибка сервера при обновлении статуса бэкапа' 
    });
  }
};

module.exports = {
  checkBackupApiKey,
  updateBackupStatus
}; 