const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Проверка API-ключа
 */
const checkApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const configPath = '/etc/disk-monitor/config.json';
  
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (apiKey === config.api_key) {
      next();
    } else {
      logger.error('Попытка обновления дисков с неверным API-ключом');
      res.status(401).json({ 
        success: false, 
        error: 'Неверный API-ключ' 
      });
    }
  } catch (error) {
    logger.error(`Ошибка проверки API-ключа: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка проверки API-ключа' 
    });
  }
};

/**
 * Обработчик обновления информации о дисках
 */
const updateDisks = (req, res) => {
  try {
    logger.info('Получен запрос на обновление информации о дисках');
    
    // Проверяем наличие информации о дисках в запросе
    if (!req.body.disks) {
      logger.warn('Отсутствуют данные о дисках в запросе');
      return res.status(400).json({ 
        success: false, 
        error: 'Отсутствуют данные о дисках' 
      });
    }
    
    // Сохраняем информацию о дисках во временный файл
    const disksData = JSON.stringify(req.body.disks, null, 2);
    const tempFile = '/tmp/agger_disks.json';
    
    fs.writeFileSync(tempFile, disksData);
    logger.info(`Информация о дисках сохранена в ${tempFile}`);
    
    // Копируем информацию в постоянное хранилище
    const storageDir = '/var/lib/disk-monitor';
    
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    
    fs.copyFileSync(tempFile, path.join(storageDir, 'agger_disks.json'));
    
    // Запускаем скрипт обновления конфигурации
    exec('/usr/local/bin/update-disk-config.sh', (error, stdout, stderr) => {
      if (error) {
        logger.error(`Ошибка при выполнении скрипта обновления: ${error.message}`);
        logger.error(`stderr: ${stderr}`);
        
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка при обновлении конфигурации дисков' 
        });
      }
      
      logger.info(`Скрипт обновления выполнен успешно: ${stdout}`);
      
      // Возвращаем успешный ответ
      res.json({ 
        success: true, 
        message: 'Информация о дисках обновлена и применена' 
      });
    });
  } catch (error) {
    logger.error(`Ошибка обновления информации о дисках: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка обновления информации о дисках' 
    });
  }
};

module.exports = {
  checkApiKey,
  updateDisks
};
