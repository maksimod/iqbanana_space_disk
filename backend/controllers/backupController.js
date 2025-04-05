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
  // Полное логирование для диагностики
  logger.info(`[BACKUP] Проверка API ключа...`);
  logger.info(`[BACKUP] Загружен API ключ из конфигурации: '${config.backupApiKey?.substring(0, 5)}...'`);
  logger.info(`[BACKUP] Получен API ключ из запроса: '${req.headers['x-api-key']?.substring(0, 5)}...'`);
  logger.info(`[BACKUP] Полные заголовки запроса: ${JSON.stringify(req.headers)}`);

  // Проверяем, задан ли ключ в конфигурации
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
    
    // Расширенное логирование
    logger.info(`[BACKUP] Получен запрос на обновление статуса для диска ${diskName}`);
    logger.info(`[BACKUP] Статус: ${status}, сообщение: ${message}`);
    
    // Проверяем наличие обязательных параметров
    if (!diskName || !status) {
      logger.error(`[BACKUP] Отсутствуют обязательные параметры: diskName=${diskName}, status=${status}`);
      return res.status(400).json({ 
        error: 'Необходимые параметры: diskName, status' 
      });
    }
    
    // Проверяем корректность статуса
    const validStatuses = ['PROCESSING', 'SUCCESS', 'ERROR'];
    if (!validStatuses.includes(status)) {
      logger.error(`[BACKUP] Недопустимый статус: ${status}`);
      return res.status(400).json({ 
        error: 'Недопустимый статус. Разрешенные статусы: PROCESSING, SUCCESS, ERROR' 
      });
    }
    
    // Ищем диск в базе данных
    logger.info(`[BACKUP] Поиск диска ${diskName} в базе данных`);
    const disk = await Disk.findOne({ name: diskName });
    
    if (!disk) {
      logger.error(`[BACKUP] Диск с именем ${diskName} не найден в базе данных`);
      return res.status(404).json({ 
        error: `Диск с именем ${diskName} не найден` 
      });
    }
    
    // Обновляем статус бэкапа
    logger.info(`[BACKUP] Обновление статуса бэкапа для диска ${diskName} на ${status}`);
    disk.backupStatus = status;
    disk.backupMessage = message || '';
    disk.backupUpdatedAt = new Date();
    
    // Сохраняем изменения
    await disk.save();
    logger.info(`[BACKUP] Статус бэкапа успешно обновлен для диска ${diskName}`);
    
    return res.status(200).json({ 
      success: true, 
      message: `Статус бэкапа диска ${diskName} обновлен на ${status}` 
    });
  } catch (error) {
    logger.error('Ошибка при обновлении статуса бэкапа:', error);
    return res.status(500).json({ 
      error: 'Внутренняя ошибка сервера при обновлении статуса бэкапа' 
    });
  }
};

module.exports = {
  checkBackupApiKey,
  updateBackupStatus
}; 