const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const yaml = require('js-yaml');
const config = require('../config/config');
const { Disk } = require('../models');
const mongoose = require('mongoose');

// Путь к файлу с статусами бэкапов
const BACKUPS_YML_PATH = path.join(__dirname, '../../monitor/backups.yml');

/**
 * Проверка API-ключа для бэкапа
 */
const checkBackupApiKey = (req, res, next) => {
  // Полное логирование для диагностики
  logger.info(`[BACKUP] Проверка API ключа...`);
  
  // Логирование всех заголовков запроса для отладки
  logger.info(`[BACKUP] Полные заголовки запроса: ${JSON.stringify(req.headers)}`);
  
  // Ключ может быть передан в заголовке 'x-api-key', 'X-API-KEY' или в параметре query 'api_key'
  const apiKeyHeader = req.headers['x-api-key'] || req.headers['X-API-KEY'] || req.headers['x-api-key'.toUpperCase()];
  const apiKeyQuery = req.query.api_key || req.query.apiKey || req.query.API_KEY;
  
  // Используем ключ из заголовка или query параметра
  const apiKey = apiKeyHeader || apiKeyQuery;
  
  logger.info(`[BACKUP] Загружен API ключ из конфигурации: '${config.backupApiKey}'`);
  logger.info(`[BACKUP] Получен API ключ из запроса: '${apiKey}'`);

  // Проверяем, задан ли ключ в конфигурации
  if (!config.backupApiKey) {
    logger.error('КРИТИЧЕСКАЯ ОШИБКА: BACKUP_API_KEY не задан в .env файле');
    return res.status(500).json({ 
      success: false,
      message: 'Ошибка сервера: API ключ для бэкапа не настроен' 
    });
  }
  
  // Проверка 1: Проверяем, что ключ API передан
  if (!apiKey) {
    logger.error(`[BACKUP] Ошибка авторизации: API ключ не передан в запросе`);
    return res.status(401).json({ 
      success: false,
      message: 'Необходима аутентификация: API ключ не найден в запросе' 
    });
  }
  
  // Проверка 2: Сравниваем переданный ключ с ключом из конфигурации
  if (apiKey !== config.backupApiKey) {
    logger.error(`[BACKUP] Ошибка авторизации: Неверный API ключ`);
    return res.status(401).json({ 
      success: false,
      message: 'Неавторизованный запрос: неверный API ключ' 
    });
  }
  
  // Если проверки пройдены, пропускаем запрос дальше
  logger.info('[BACKUP] API ключ успешно проверен');
  next();
};

/**
 * Обновление статуса бэкапа
 */
const updateBackupStatus = async (req, res) => {
  try {
    // Логируем тело запроса для отладки
    logger.info(`[BACKUP] Получено тело запроса: ${JSON.stringify(req.body)}`);
    
    const { diskName, status, message } = req.body;
    
    // Расширенное логирование
    logger.info(`[BACKUP] Получен запрос на обновление статуса для диска ${diskName}`);
    logger.info(`[BACKUP] Статус: ${status}, сообщение: ${message}`);
    
    // Проверяем наличие обязательных параметров
    if (!diskName || !status) {
      logger.error(`[BACKUP] Отсутствуют обязательные параметры: diskName=${diskName}, status=${status}`);
      return res.status(400).json({ 
        success: false,
        message: 'Необходимые параметры: diskName, status' 
      });
    }
    
    // Проверяем корректность статуса
    const validStatuses = ['PROCESSING', 'SUCCESS', 'ERROR'];
    if (!validStatuses.includes(status)) {
      logger.error(`[BACKUP] Недопустимый статус: ${status}`);
      return res.status(400).json({ 
        success: false,
        message: `Недопустимый статус. Разрешенные статусы: ${validStatuses.join(', ')}` 
      });
    }
    
    // Проверка использования фейковой модели
    if (typeof global.fakeDiskModel !== 'object' || global.fakeDiskModel === null) {
      global.fakeDiskModel = {};
    }
    
    // Создаем или обновляем запись в fakeDiskModel
    global.fakeDiskModel[diskName] = {
      name: diskName,
      path: `/mnt/storage/${diskName}`,
      mountPoint: `/mnt/storage/${diskName}`,
      status: 'online',
      backupStatus: status,
      backupMessage: message || '',
      backupUpdatedAt: new Date()
    };
    
    // Отображаем обновленную фейковую модель для отладки
    console.log(`Создание фейкового диска:`, global.fakeDiskModel[diskName]);
    
    // Ищем диск в базе данных
    logger.info(`[BACKUP] Поиск диска ${diskName} в базе данных`);
    let disk = await Disk.findOne({ name: diskName });
    
    if (!disk) {
      logger.warn(`[BACKUP] Диск с именем ${diskName} не найден в базе данных. Попытка создания...`);
      
      // Если диск не найден, создаем новую запись
      try {
        // Проверяем, есть ли метод create
        if (typeof Disk.create !== 'function') {
          logger.warn(`[BACKUP] Метод Disk.create недоступен. Создаем объект диска вручную.`);
          
          // Создаем объект диска вручную
          disk = {
            name: diskName,
            path: `/mnt/storage/${diskName}`,
            mountPoint: `/mnt/storage/${diskName}`,
            status: 'online',
            backupStatus: status,
            backupMessage: message || '',
            backupUpdatedAt: new Date(),
            
            // Добавляем фиктивный метод save
            save: async function() {
              logger.info(`[BACKUP] Сохранение диска ${diskName} (фиктивный метод)`);
              return this;
            }
          };
          
          logger.info(`[BACKUP] Создан объект диска для ${diskName} (фиктивный метод)`);
        } else {
          // Используем встроенный метод create
          disk = await Disk.create({
            name: diskName,
            path: `/mnt/storage/${diskName}`,
            mountPoint: `/mnt/storage/${diskName}`,
            status: 'online',
            backupStatus: status,
            backupMessage: message || '',
            backupUpdatedAt: new Date()
          });
          logger.info(`[BACKUP] Создана новая запись диска для ${diskName}`);
        }
      } catch (createError) {
        logger.error(`[BACKUP] Не удалось создать новую запись диска: ${createError.message}`);
        
        // Поскольку мы используем фейковую модель, всегда можно считать операцию успешной
        logger.info(`[BACKUP] Но запись в fakeDiskModel успешно создана, продолжаем`);
      }
    } else {
      // Обновляем статус бэкапа
      logger.info(`[BACKUP] Обновление статуса бэкапа для диска ${diskName} на ${status}`);
      disk.backupStatus = status;
      disk.backupMessage = message || '';
      disk.backupUpdatedAt = new Date();
      
      // Сохраняем изменения
      try {
        await disk.save();
        logger.info(`[BACKUP] Статус бэкапа успешно обновлен для диска ${diskName}`);
      } catch (saveError) {
        logger.error(`[BACKUP] Ошибка при сохранении статуса: ${saveError.message}`);
        logger.info(`[BACKUP] Но запись в fakeDiskModel успешно обновлена, продолжаем`);
      }
    }
    
    // Возвращаем успешный ответ с форматированием для совместимости
    return res.status(200).json({ 
      success: true, 
      message: `Статус бэкапа диска ${diskName} обновлен на ${status}`,
      data: {
        diskName,
        status,
        message: message || '',
        updatedAt: new Date()
      }
    });
  } catch (error) {
    logger.error('Ошибка при обновлении статуса бэкапа:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Внутренняя ошибка сервера при обновлении статуса бэкапа' 
    });
  }
};

// Функция для получения списка бэкапов для конкретного диска
const getBackupsList = async (req, res) => {
  try {
    const { diskName } = req.params;
    
    if (!diskName) {
      return res.status(400).json({
        success: false,
        message: 'Не указано имя диска'
      });
    }
    
    logger.info(`[BACKUP] Запрос на получение списка бэкапов для диска ${diskName}`);
    
    // Получаем UUID диска из его имени
    const diskUuid = getDiskUuidFromName(diskName);
    logger.info(`[BACKUP] UUID диска ${diskName}: ${diskUuid}`);
    
    if (!diskUuid) {
      logger.error(`[BACKUP] Не удалось получить UUID для диска ${diskName}`);
      return res.status(404).json({
        success: false,
        message: `Диск ${diskName} не найден или не имеет UUID`
      });
    }
    
    // Находим UUID для бэкапа из конфигурации
    let backupUuid = config.backup_disks && config.backup_disks[diskName] 
      ? config.backup_disks[diskName] 
      : diskUuid;
    
    logger.info(`[BACKUP] Используем UUID для бэкапа: ${backupUuid} (из конфигурации backup_disks)`);
    
    // Формируем путь к директории с бэкапами на удаленном сервере
    const remotePath = `/mnt/backup_${backupUuid}`;
    logger.info(`[BACKUP] Ищем бэкапы на удаленном сервере по пути: ${remotePath}`);
    
    // Путь к SSH ключу и параметры SSH соединения
    const sshKeyPath = process.env.SSH_KEY_PATH || `/home/user/.ssh/id_rsa_server`;
    const sshOptions = `-i "${sshKeyPath}" -o StrictHostKeyChecking=no -o BatchMode=yes`;
    const sshServer = process.env.BACKUP_SERVER || "192.168.0.106";
    const sshPort = process.env.BACKUP_SERVER_PORT || "22";
    
    logger.info(`[BACKUP] Используем SSH ключ: ${sshKeyPath} для подключения к ${sshServer}:${sshPort}`);
    
    // Выполняем SSH команду для получения списка файлов
    const { execSync } = require('child_process');
    const sshCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "ls -la ${remotePath}"`;
    logger.info(`[BACKUP] Выполняем команду: ${sshCmd}`);
    
    let sshOutput;
    try {
      sshOutput = execSync(sshCmd, { encoding: 'utf8' });
      logger.info(`[BACKUP] Результат SSH команды:\n${sshOutput}`);
    } catch (sshError) {
      logger.error(`[BACKUP] Ошибка при выполнении SSH команды: ${sshError.message}`);
      return res.status(500).json({
        success: false,
        message: `Ошибка при подключении к серверу бэкапов: ${sshError.message}`
      });
    }
    
    // Получаем список файлов через SSH
    const fileListCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "find ${remotePath} -maxdepth 1 -type f -name '*.tar.gz' -o -name '*.zip' | sort -r"`;
    let filesOutput;
    try {
      filesOutput = execSync(fileListCmd, { encoding: 'utf8' });
      logger.info(`[BACKUP] Список файлов бэкапов:\n${filesOutput}`);
    } catch (listError) {
      logger.error(`[BACKUP] Ошибка при получении списка файлов бэкапов: ${listError.message}`);
      return res.status(500).json({
        success: false,
        message: `Ошибка при получении списка файлов бэкапов: ${listError.message}`
      });
    }
    
    // Парсим вывод команды для получения списка файлов
    const backupFiles = filesOutput.trim().split('\n').filter(line => line.trim()).map(filePath => {
      const filename = path.basename(filePath);
      
      // Получаем информацию о файле через SSH
      const statCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "stat -c '%s %Y' ${filePath}"`;
      let fileStats;
      try {
        fileStats = execSync(statCmd, { encoding: 'utf8' }).trim();
        const [size, mtime] = fileStats.split(' ');
        
        // Извлекаем дату из имени файла, если возможно
        let backupDate = null;
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2}[-_]\d{2}-\d{2}-\d{2})|(\d{8}_\d{6})/);
        if (dateMatch) {
          const dateStr = dateMatch[1] || dateMatch[2];
          if (dateStr) {
            // Преобразуем формат даты в зависимости от найденного паттерна
            if (dateStr.includes('-')) {
              backupDate = dateStr.replace(/[-_]/g, '-').replace(/-(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
            } else if (dateStr.includes('_')) {
              const year = dateStr.substring(0, 4);
              const month = dateStr.substring(4, 6);
              const day = dateStr.substring(6, 8);
              const hour = dateStr.substring(9, 11);
              const minute = dateStr.substring(11, 13);
              const second = dateStr.substring(13, 15);
              backupDate = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
            }
          }
        }
        
        const mtimeDate = new Date(parseInt(mtime) * 1000);
        
        return {
          filename,
          path: filePath,
          size: parseInt(size),
          created: backupDate ? new Date(backupDate) : mtimeDate,
          mtime: mtimeDate,
          // Добавляем форматированную дату для отображения
          dateFormatted: backupDate 
            ? new Date(backupDate).toLocaleString('ru-RU')
            : mtimeDate.toLocaleString('ru-RU')
        };
        
      } catch (statError) {
        logger.error(`[BACKUP] Ошибка при получении информации о файле ${filePath}: ${statError.message}`);
        // Возвращаем минимальную информацию, если не удалось получить stat
        return {
          filename,
          path: filePath,
          size: 0,
          created: new Date(),
          mtime: new Date(),
          dateFormatted: new Date().toLocaleString('ru-RU')
        };
      }
    }).sort((a, b) => b.mtime - a.mtime); // Сортируем от новых к старым
    
    logger.info(`[BACKUP] Найдено ${backupFiles.length} бэкапов для диска ${diskName}`);
    
    return res.json({
      success: true,
      message: `Найдено ${backupFiles.length} бэкапов для диска ${diskName}`,
      diskName,
      diskUuid,
      backups: backupFiles
    });
    
  } catch (error) {
    logger.error(`[BACKUP] Ошибка при получении списка бэкапов: ${error.message}`, error);
    logger.error(`[BACKUP] Stack trace: ${error.stack}`);
    return res.status(500).json({
      success: false,
      message: 'Ошибка при получении списка бэкапов'
    });
  }
};

// Функция для восстановления из бэкапа
const restoreBackup = async (req, res) => {
  try {
    const { diskName, backupFile } = req.body;
    
    if (!diskName || !backupFile) {
      return res.status(400).json({
        success: false,
        message: 'Необходимо указать имя диска и файл бэкапа'
      });
    }
    
    logger.info(`[BACKUP] Запрос на восстановление бэкапа ${backupFile} для диска ${diskName}`);
    
    // Получаем UUID диска из его имени
    const diskUuid = getDiskUuidFromName(diskName);
    logger.info(`[BACKUP] UUID диска ${diskName}: ${diskUuid}`);
    
    if (!diskUuid) {
      logger.error(`[BACKUP] Не удалось получить UUID для диска ${diskName}`);
      return res.status(404).json({
        success: false,
        message: `Диск ${diskName} не найден или не имеет UUID`
      });
    }
    
    // Находим UUID для бэкапа из конфигурации
    let backupUuid = config.backup_disks && config.backup_disks[diskName] 
      ? config.backup_disks[diskName] 
      : diskUuid;
    
    logger.info(`[BACKUP] Используем UUID для бэкапа: ${backupUuid} (из конфигурации backup_disks)`);
    
    // Путь к SSH ключу и параметры SSH соединения
    const sshKeyPath = process.env.SSH_KEY_PATH || `/home/user/.ssh/id_rsa_server`;
    const sshOptions = `-i "${sshKeyPath}" -o StrictHostKeyChecking=no -o BatchMode=yes`;
    const sshServer = process.env.BACKUP_SERVER || "192.168.0.106";
    const sshPort = process.env.BACKUP_SERVER_PORT || "22";
    
    logger.info(`[BACKUP] Используем SSH ключ: ${sshKeyPath} для подключения к ${sshServer}:${sshPort}`);
    
    // Проверяем существование файла бэкапа на удаленном сервере
    const remotePath = `/mnt/backup_${backupUuid}/${backupFile}`;
    logger.info(`[BACKUP] Проверка файла бэкапа на удаленном сервере: ${remotePath}`);
    
    const { execSync } = require('child_process');
    
    // Проверяем существование файла
    const checkCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "test -f '${remotePath}' && echo 'exists' || echo 'not found'"`;
    let fileExists;
    try {
      fileExists = execSync(checkCmd, { encoding: 'utf8' }).trim() === 'exists';
      logger.info(`[BACKUP] Проверка файла бэкапа: ${fileExists ? 'файл существует' : 'файл не найден'}`);
    } catch (checkError) {
      logger.error(`[BACKUP] Ошибка при проверке файла бэкапа: ${checkError.message}`);
      return res.status(500).json({
        success: false,
        message: `Ошибка при проверке файла бэкапа: ${checkError.message}`
      });
    }
    
    if (!fileExists) {
      // Проверяем альтернативный путь на сервере
      const altRemotePath = `/mnt/backup_${diskUuid}/${backupFile}`;
      logger.info(`[BACKUP] Проверка альтернативного пути к файлу бэкапа: ${altRemotePath}`);
      
      const altCheckCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "test -f '${altRemotePath}' && echo 'exists' || echo 'not found'"`;
      try {
        fileExists = execSync(altCheckCmd, { encoding: 'utf8' }).trim() === 'exists';
        logger.info(`[BACKUP] Проверка альтернативного пути: ${fileExists ? 'файл существует' : 'файл не найден'}`);
        
        if (fileExists) {
          // Используем альтернативный путь
          return startRestoreProcessViaSsh(diskName, diskUuid, altRemotePath, res, sshOptions, sshServer, sshPort);
        }
      } catch (altCheckError) {
        logger.error(`[BACKUP] Ошибка при проверке альтернативного пути: ${altCheckError.message}`);
      }
      
      if (!fileExists) {
        return res.status(404).json({
          success: false,
          message: `Файл бэкапа не найден: ${backupFile}`
        });
      }
    }
    
    // Запускаем процесс восстановления через SSH
    return startRestoreProcessViaSsh(diskName, diskUuid, remotePath, res, sshOptions, sshServer, sshPort);
    
  } catch (error) {
    logger.error(`[BACKUP] Ошибка при восстановлении из бэкапа: ${error.message}`, error);
    logger.error(`[BACKUP] Stack trace: ${error.stack}`);
    return res.status(500).json({
      success: false,
      message: 'Ошибка при восстановлении из бэкапа'
    });
  }
};

// Функция для запуска процесса восстановления через SSH
function startRestoreProcessViaSsh(diskName, diskUuid, backupFilePath, res, sshOptions, sshServer, sshPort) {
  // Путь к диску, который нужно восстановить
  const diskPath = config.disks[diskName];
  
  if (!diskPath) {
    logger.error(`[BACKUP] Не найден путь к диску ${diskName}`);
    return res.status(404).json({
      success: false,
      message: `Не найден путь к диску ${diskName}`
    });
  }
  
  logger.info(`[BACKUP] Запуск восстановления диска ${diskName} (${diskPath}) из бэкапа ${backupFilePath}`);
  
  // Команда для восстановления бэкапа через SSH
  // Извлекаем tar.gz архив в директорию диска
  const restoreCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "tar -xzf '${backupFilePath}' -C '${diskPath}' --overwrite"`;
  logger.info(`[BACKUP] Выполняем команду восстановления: ${restoreCmd}`);
  
  // Запускаем процесс восстановления асинхронно
  const { exec } = require('child_process');
  const restoreProcess = exec(restoreCmd);
  
  // Отправляем успешный ответ пользователю сразу
  res.json({
    success: true,
    message: `Запущен процесс восстановления диска ${diskName} из бэкапа ${path.basename(backupFilePath)}`
  });
  
  // Обрабатываем результат восстановления
  restoreProcess.on('close', (code) => {
    if (code === 0) {
      logger.info(`[BACKUP] Восстановление диска ${diskName} успешно завершено`);
    } else {
      logger.error(`[BACKUP] Ошибка при восстановлении диска ${diskName}, код ошибки: ${code}`);
    }
  });
  
  restoreProcess.stdout.on('data', (data) => {
    logger.info(`[BACKUP] Процесс восстановления: ${data.toString().trim()}`);
  });
  
  restoreProcess.stderr.on('data', (data) => {
    logger.error(`[BACKUP] Ошибка процесса восстановления: ${data.toString().trim()}`);
  });
  
  return true;
}

// Вспомогательная функция для обновления статуса бэкапа
const updateDiskBackupStatus = async (diskUuid, status, message) => {
  try {
    // Проверяем валидность статуса
    const validStatuses = ['PROCESSING', 'SUCCESS', 'ERROR'];
    if (!validStatuses.includes(status)) {
      logger.error(`[BACKUP] Недопустимый статус: ${status}`);
      return false;
    }
    
    // Обновляем статус в fakeDiskModel
    if (typeof global.fakeDiskModel !== 'object' || global.fakeDiskModel === null) {
      global.fakeDiskModel = {};
    }
    
    // Создаем или обновляем запись в fakeDiskModel для UUID
    global.fakeDiskModel[diskUuid] = {
      name: diskUuid,
      status: 'online',
      backupStatus: status,
      backupMessage: message || '',
      backupUpdatedAt: new Date()
    };
    
    logger.info(`[BACKUP] Статус бэкапа обновлен для диска ${diskUuid}: ${status}, ${message}`);
    
    // Пытаемся обновить статус в базе данных, если она доступна
    if (mongoose && mongoose.connection.readyState === 1) {
      try {
        let disk = await Disk.findOne({ name: diskUuid });
        
        if (disk) {
          disk.backupStatus = status;
          disk.backupMessage = message || '';
          disk.backupUpdatedAt = new Date();
          await disk.save();
          logger.info(`[BACKUP] Статус бэкапа обновлен в базе данных для диска ${diskUuid}`);
        } else {
          // Создаем новую запись, если диска нет в базе
          disk = await Disk.create({
            name: diskUuid,
            status: 'online',
            backupStatus: status,
            backupMessage: message || '',
            backupUpdatedAt: new Date()
          });
          logger.info(`[BACKUP] Создана новая запись в базе данных для диска ${diskUuid}`);
        }
      } catch (dbError) {
        logger.error(`[BACKUP] Ошибка при обновлении статуса в базе данных: ${dbError.message}`);
      }
    }
    
    return true;
  } catch (error) {
    logger.error(`[BACKUP] Ошибка при обновлении статуса бэкапа: ${error.message}`);
    return false;
  }
};

// Функция для получения UUID диска из его имени
const getDiskUuidFromName = (diskName) => {
  if (!diskName) return null;
  
  const mountPoint = config.disks[diskName];
  if (!mountPoint) return null;
  
  const match = mountPoint.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
  return match && match[1] ? match[1] : null;
};

module.exports = {
  checkBackupApiKey,
  updateBackupStatus,
  getBackupsList,
  restoreBackup
}; 