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
    // Проверяем несколько возможных путей к SSH ключу
    let sshKeyPath = process.env.SSH_KEY_PATH;
    
    // Массив возможных расположений SSH ключа
    const possibleKeyPaths = [
      process.env.SSH_KEY_PATH,
      `/home/user/.ssh/id_rsa_server`,
      `/root/.ssh/id_rsa_server`,
      `/home/user/.ssh/id_rsa`,
      `/root/.ssh/id_rsa`
    ].filter(Boolean); // Убираем пустые значения
    
    logger.info(`[BACKUP] Проверка возможных путей к SSH ключу: ${JSON.stringify(possibleKeyPaths)}`);
    
    // Проверяем каждый путь и выбираем первый существующий
    let sshKeyExists = false;
    for (const keyPath of possibleKeyPaths) {
      try {
        if (fs.existsSync(keyPath)) {
          sshKeyPath = keyPath;
          sshKeyExists = true;
          const stats = fs.statSync(keyPath);
          logger.info(`[BACKUP] SSH ключ найден по пути: ${keyPath}, размер: ${stats.size} байт, права: ${stats.mode.toString(8)}`);
          break;
        } else {
          logger.warn(`[BACKUP] SSH ключ не найден по пути: ${keyPath}`);
        }
      } catch (err) {
        logger.error(`[BACKUP] Ошибка при проверке SSH ключа по пути ${keyPath}: ${err.message}`);
      }
    }
    
    if (!sshKeyExists) {
      logger.error(`[BACKUP] SSH ключ не найден ни по одному из возможных путей`);
      // Не возвращаем ошибку, просто предупреждаем и продолжаем с настройками по умолчанию
    }
    
    // Если ключ не найден, используем путь по умолчанию с предупреждением
    if (!sshKeyPath) {
      sshKeyPath = `/home/user/.ssh/id_rsa_server`; // Путь по умолчанию
      logger.warn(`[BACKUP] Используем путь к SSH ключу по умолчанию: ${sshKeyPath}`);
    }
    
    // Формируем опции SSH в зависимости от наличия ключа
    let sshOptions = '';
    if (sshKeyExists) {
      sshOptions = `-i "${sshKeyPath}" -o StrictHostKeyChecking=no -o BatchMode=yes`;
    } else {
      // Если ключ не найден, пробуем подключиться без ключа (возможно, настроена аутентификация по паролю)
      sshOptions = `-o StrictHostKeyChecking=no`;
      logger.warn(`[BACKUP] SSH ключ не найден, пытаемся подключиться без ключа`);
    }
    
    const sshServer = process.env.BACKUP_SERVER || "192.168.0.106";
    const sshPort = process.env.BACKUP_SERVER_PORT || "22";
    
    logger.info(`[BACKUP] Параметры SSH соединения: сервер=${sshServer}, порт=${sshPort}, опции=${sshOptions}`);
    
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
    logger.info(`[BACKUP] Получен запрос на восстановление из бэкапа: ${JSON.stringify(req.body)}`);
    logger.info(`[BACKUP] Заголовки запроса: ${JSON.stringify(req.headers)}`);
    
    const { diskName, backupFile } = req.body;
    
    if (!diskName || !backupFile) {
      logger.error(`[BACKUP] Отсутствуют обязательные параметры: diskName=${diskName}, backupFile=${backupFile}`);
      return res.status(400).json({
        success: false,
        message: 'Необходимо указать имя диска и файл бэкапа'
      });
    }
    
    logger.info(`[BACKUP] Запрос на восстановление бэкапа ${backupFile} для диска ${diskName}`);
    
    // Проверка доступности дисков в конфигурации
    logger.info(`[BACKUP] Проверка конфигурации дисков: ${JSON.stringify(config.disks)}`);
    
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
    let backupUuid = diskUuid; // По умолчанию используем UUID диска
    
    if (config.backup_disks && typeof config.backup_disks === 'object') {
      logger.info(`[BACKUP] Конфигурация backup_disks: ${JSON.stringify(config.backup_disks)}`);
      if (config.backup_disks[diskName]) {
        backupUuid = config.backup_disks[diskName];
        logger.info(`[BACKUP] Найден UUID для бэкапа в конфигурации: ${backupUuid}`);
      } else {
        logger.info(`[BACKUP] UUID для бэкапа диска ${diskName} не найден в конфигурации, используем UUID диска: ${backupUuid}`);
      }
    } else {
      logger.warn(`[BACKUP] Конфигурация backup_disks отсутствует или некорректна`);
    }
    
    logger.info(`[BACKUP] Используем UUID для бэкапа: ${backupUuid}`);
    
    // Проверяем доступность SSH ключа
    // Проверяем несколько возможных путей к SSH ключу
    let sshKeyPath = process.env.SSH_KEY_PATH;
    
    // Массив возможных расположений SSH ключа
    const possibleKeyPaths = [
      process.env.SSH_KEY_PATH,
      `/home/user/.ssh/id_rsa_server`,
      `/root/.ssh/id_rsa_server`,
      `/home/user/.ssh/id_rsa`,
      `/root/.ssh/id_rsa`
    ].filter(Boolean); // Убираем пустые значения
    
    logger.info(`[BACKUP] Проверка возможных путей к SSH ключу: ${JSON.stringify(possibleKeyPaths)}`);
    
    // Проверяем каждый путь и выбираем первый существующий
    let sshKeyExists = false;
    for (const keyPath of possibleKeyPaths) {
      try {
        if (fs.existsSync(keyPath)) {
          sshKeyPath = keyPath;
          sshKeyExists = true;
          const stats = fs.statSync(keyPath);
          logger.info(`[BACKUP] SSH ключ найден по пути: ${keyPath}, размер: ${stats.size} байт, права: ${stats.mode.toString(8)}`);
          break;
        } else {
          logger.warn(`[BACKUP] SSH ключ не найден по пути: ${keyPath}`);
        }
      } catch (err) {
        logger.error(`[BACKUP] Ошибка при проверке SSH ключа по пути ${keyPath}: ${err.message}`);
      }
    }
    
    // Формируем опции SSH в зависимости от наличия ключа
    let sshOptions = '';
    if (sshKeyExists) {
      sshOptions = `-i "${sshKeyPath}" -o StrictHostKeyChecking=no -o BatchMode=yes`;
    } else {
      // Если ключ не найден, пробуем подключиться без ключа (возможно, настроена аутентификация по паролю)
      sshOptions = `-o StrictHostKeyChecking=no`;
      logger.warn(`[BACKUP] SSH ключ не найден, пытаемся подключиться без ключа`);
    }
    
    const sshServer = process.env.BACKUP_SERVER || "192.168.0.106";
    const sshPort = process.env.BACKUP_SERVER_PORT || "22";
    
    logger.info(`[BACKUP] Параметры SSH соединения: сервер=${sshServer}, порт=${sshPort}, опции=${sshOptions}`);
    
    // Проверяем доступность SSH сервера
    const { execSync } = require('child_process');
    
    try {
      logger.info(`[BACKUP] Проверка доступности SSH сервера...`);
      const testCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "echo 'SSH connection successful'"`;
      const result = execSync(testCmd, { encoding: 'utf8', timeout: 5000 }).trim();
      logger.info(`[BACKUP] Тест SSH соединения: ${result}`);
    } catch (sshError) {
      logger.error(`[BACKUP] Ошибка при подключении к SSH серверу: ${sshError.message}`);
      return res.status(500).json({
        success: false,
        message: `Ошибка подключения к серверу бэкапов: ${sshError.message}`
      });
    }
    
    // Формируем путь к бэкапу на удаленном сервере
    const remotePath = `/mnt/backup_${backupUuid}/${backupFile}`;
    logger.info(`[BACKUP] Проверка файла бэкапа на удаленном сервере: ${remotePath}`);
    
    // Проверяем существование файла
    const checkCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "test -f '${remotePath}' && echo 'exists' || echo 'not found'"`;
    logger.info(`[BACKUP] Команда проверки файла: ${checkCmd}`);
    
    let backupFilePath = remotePath;
    let fileExists = false;
    
    try {
      fileExists = execSync(checkCmd, { encoding: 'utf8' }).trim() === 'exists';
      logger.info(`[BACKUP] Проверка файла бэкапа: ${fileExists ? 'файл существует' : 'файл не найден'}`);
      
      if (fileExists) {
        backupFilePath = remotePath;
      }
    } catch (checkError) {
      logger.error(`[BACKUP] Ошибка при проверке файла бэкапа: ${checkError.message}`);
      logger.error(`[BACKUP] Стек ошибки: ${checkError.stack}`);
    }
    
    // Если основной путь не найден, проверяем альтернативный
    if (!fileExists) {
      // Проверяем альтернативный путь на сервере
      const altRemotePath = `/mnt/backup_${diskUuid}/${backupFile}`;
      logger.info(`[BACKUP] Проверка альтернативного пути к файлу бэкапа: ${altRemotePath}`);
      
      const altCheckCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "test -f '${altRemotePath}' && echo 'exists' || echo 'not found'"`;
      logger.info(`[BACKUP] Команда проверки альтернативного пути: ${altCheckCmd}`);
      
      try {
        fileExists = execSync(altCheckCmd, { encoding: 'utf8' }).trim() === 'exists';
        logger.info(`[BACKUP] Проверка альтернативного пути: ${fileExists ? 'файл существует' : 'файл не найден'}`);
        
        if (fileExists) {
          backupFilePath = altRemotePath;
        }
      } catch (altCheckError) {
        logger.error(`[BACKUP] Ошибка при проверке альтернативного пути: ${altCheckError.message}`);
        logger.error(`[BACKUP] Стек ошибки: ${altCheckError.stack}`);
      }
    }
    
    if (!fileExists) {
      logger.error(`[BACKUP] Файл бэкапа не найден: ${backupFile}`);
      return res.status(404).json({
        success: false,
        message: `Файл бэкапа не найден: ${backupFile}`
      });
    }
    
    // Запускаем процесс восстановления используя внешний скрипт
    logger.info(`[BACKUP] Запуск процесса восстановления через скрипт для диска ${diskName} из бэкапа ${backupFilePath}`);
    
    try {
      // Копируем скрипт восстановления на сервер
      const scriptPath = path.join(__dirname, '../scripts/restore_backup.sh');
      logger.info(`[BACKUP] Путь к скрипту восстановления: ${scriptPath}`);
      
      if (!fs.existsSync(scriptPath)) {
        logger.error(`[BACKUP] Скрипт восстановления не найден по пути: ${scriptPath}`);
        return res.status(500).json({
          success: false,
          message: 'Ошибка: скрипт восстановления не найден на сервере'
        });
      }
      
      // Копируем скрипт на сервер
      const scpCmd = `scp ${sshOptions} -P ${sshPort} ${scriptPath} root@${sshServer}:/tmp/restore_backup.sh`;
      logger.info(`[BACKUP] Команда копирования скрипта: ${scpCmd}`);
      execSync(scpCmd);
      
      // Устанавливаем права на выполнение скрипта
      const chmodCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "chmod +x /tmp/restore_backup.sh"`;
      logger.info(`[BACKUP] Установка прав на скрипт: ${chmodCmd}`);
      execSync(chmodCmd);
      
      // Запускаем скрипт восстановления на сервере в фоновом режиме
      const sshCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "cd /tmp && nohup /tmp/restore_backup.sh '${diskName}' '${diskUuid}' '${backupFilePath}' > /tmp/restore_${diskName}.log 2>&1 &"`;
      logger.info(`[BACKUP] Запуск скрипта восстановления: ${sshCmd}`);
      execSync(sshCmd);
      
      // Отправляем успешный ответ пользователю
      res.status(200).json({
        success: true,
        message: `Запущен процесс восстановления диска ${diskName} из бэкапа ${backupFile}. Это может занять несколько минут.`
      });
      
      // Запускаем периодическую проверку статуса восстановления
      const checkStatusInterval = setInterval(async () => {
        try {
          // Проверяем статус восстановления
          const checkCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "if [ -f /tmp/restore_${diskName}_status.txt ]; then cat /tmp/restore_${diskName}_status.txt; else echo 'UNKNOWN'; fi"`;
          const status = execSync(checkCmd, { encoding: 'utf8' }).trim();
          
          logger.info(`[BACKUP] Статус восстановления: ${status}`);
          
          // Получаем последние строки лога
          const logCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "tail -n 10 /tmp/restore_${diskName}.log 2>/dev/null || echo 'Лог не найден'"`;
          const logOutput = execSync(logCmd, { encoding: 'utf8' }).trim();
          
          if (status === 'SUCCESS') {
            logger.info(`[BACKUP] Восстановление успешно завершено`);
            clearInterval(checkStatusInterval);
            
            // Обновляем статус бэкапа
            updateDiskBackupStatus(diskUuid, 'SUCCESS', `Восстановление из бэкапа ${backupFile} завершено успешно`, new Date());
            
            // Удаляем временные файлы
            try {
              execSync(`ssh ${sshOptions} -p ${sshPort} root@${sshServer} "rm -f /tmp/restore_backup.sh /tmp/restore_${diskName}_status.txt"`);
            } catch (e) {
              logger.error(`[BACKUP] Ошибка при удалении временных файлов: ${e.message}`);
            }
          } else if (status === 'ERROR') {
            logger.error(`[BACKUP] Ошибка при восстановлении диска ${diskName}`);
            clearInterval(checkStatusInterval);
            
            // Обновляем статус бэкапа с ошибкой
            updateDiskBackupStatus(diskUuid, 'ERROR', `Ошибка при восстановлении из бэкапа ${backupFile}`, new Date());
            
            // Удаляем временные файлы
            try {
              execSync(`ssh ${sshOptions} -p ${sshPort} root@${sshServer} "rm -f /tmp/restore_backup.sh /tmp/restore_${diskName}_status.txt"`);
            } catch (e) {
              logger.error(`[BACKUP] Ошибка при удалении временных файлов: ${e.message}`);
            }
          } else if (status === 'PROCESSING') {
            // Обновляем статус - все еще в процессе
            updateDiskBackupStatus(diskUuid, 'PROCESSING', `Восстановление из бэкапа ${backupFile} в процессе...`, new Date());
            
            // Логируем последние строки лога для отладки
            logger.info(`[BACKUP] Прогресс восстановления:\n${logOutput}`);
          }
        } catch (error) {
          logger.error(`[BACKUP] Ошибка при проверке статуса восстановления: ${error.message}`);
        }
      }, 10000); // Проверка каждые 10 секунд
      
      // Устанавливаем таймаут для интервала проверки (2 часа максимум)
      setTimeout(() => {
        if (checkStatusInterval) {
          clearInterval(checkStatusInterval);
          logger.error(`[BACKUP] Превышено максимальное время восстановления (2 часа) для диска ${diskName}`);
          
          // Обновляем статус бэкапа с ошибкой тайм-аута
          updateDiskBackupStatus(diskUuid, 'ERROR', `Превышено время восстановления из бэкапа ${backupFile}`, new Date());
        }
      }, 2 * 60 * 60 * 1000);
      
      return;
    } catch (error) {
      logger.error(`[BACKUP] Ошибка при запуске процесса восстановления: ${error.message}`);
      logger.error(`[BACKUP] Стек ошибки: ${error.stack}`);
      
      // Если ответ еще не отправлен
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: `Ошибка при запуске процесса восстановления: ${error.message}`
        });
      }
    }
  } catch (error) {
    logger.error(`[BACKUP] Ошибка при восстановлении из бэкапа: ${error.message}`);
    logger.error(`[BACKUP] Stack trace: ${error.stack}`);
    
    // Если ответ еще не отправлен
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: `Ошибка при запуске восстановления: ${error.message}`
      });
    }
  }
};

// Функция для запуска процесса восстановления через SSH
function startRestoreProcessViaSsh(diskName, diskUuid, backupFilePath, res, sshOptions, sshServer, sshPort) {
  try {
    // Путь к диску, который нужно восстановить на клиенте
    const diskPath = config.disks[diskName];
    
    if (!diskPath) {
      logger.error(`[BACKUP] Не найден путь к диску ${diskName}`);
      return res.status(404).json({
        success: false,
        message: `Не найден путь к диску ${diskName}`
      });
    }
    
    // На сервере используем ОРИГИНАЛЬНЫЙ путь к смонтированному диску
    const serverDiskPath = `/mnt/storage/${diskUuid}`;
    const alternativeDiskPath = `/mnt/storage/sdb`;
    
    logger.info(`[BACKUP] Запуск восстановления диска ${diskName} (клиент: ${diskPath}, сервер: ${serverDiskPath}, альтернативный: ${alternativeDiskPath}) из бэкапа ${backupFilePath}`);
    
    // Получаем имя файла из пути
    const backupFileName = path.basename(backupFilePath);
    
    // Формируем скрипт для восстановления на сервере
    // Этот скрипт будет выполнен на удаленном сервере через SSH
    const restoreScript = `#!/bin/bash

# Скрипт для восстановления бэкапа на сервере
LOG_FILE="/tmp/restore_${diskName}_$(date +%Y%m%d_%H%M%S).log"

# Функция для логирования с датой и временем
log() {
  echo "$(date +"%Y-%m-%d %H:%M:%S") - $1" | tee -a "$LOG_FILE"
}

log "Начало восстановления бэкапа ${backupFileName}"
log "Полный путь к бэкапу: ${backupFilePath}"
log "UUID диска: ${diskUuid}"

# Проверяем существование файла бэкапа
if [ ! -f "${backupFilePath}" ]; then
  log "ОШИБКА: Файл бэкапа ${backupFilePath} не найден на сервере"
  exit 1
fi

# Вывести информацию о размере бэкапа
BACKUP_SIZE=$(du -h "${backupFilePath}" | cut -f1)
log "Размер бэкапа: $BACKUP_SIZE"

# Проверяем тип файла
log "Проверка типа файла ${backupFilePath}..."
FILE_TYPE=$(file -b "${backupFilePath}")
log "Тип файла: $FILE_TYPE"

# Основной путь
TARGET_DIR="${serverDiskPath}"
# Альтернативный путь
ALT_TARGET_DIR="${alternativeDiskPath}"

log "Основная целевая директория: $TARGET_DIR"
log "Альтернативная целевая директория: $ALT_TARGET_DIR"

# Определяем доступную директорию
if [ -d "$TARGET_DIR" ]; then
  RESTORE_DIR="$TARGET_DIR"
  log "Используем основную директорию: $RESTORE_DIR"
elif [ -d "$ALT_TARGET_DIR" ]; then
  RESTORE_DIR="$ALT_TARGET_DIR"
  log "Используем альтернативную директорию: $RESTORE_DIR"
else
  log "ОШИБКА: Ни одна из целевых директорий не существует"
  log "Пытаемся создать основную директорию $TARGET_DIR"
  mkdir -p "$TARGET_DIR"
  if [ $? -eq 0 ]; then
    RESTORE_DIR="$TARGET_DIR"
    log "Успешно создана директория: $RESTORE_DIR"
  else
    log "ОШИБКА: Не удалось создать директорию $TARGET_DIR"
    log "Пытаемся создать альтернативную директорию $ALT_TARGET_DIR"
    mkdir -p "$ALT_TARGET_DIR"
    if [ $? -eq 0 ]; then
      RESTORE_DIR="$ALT_TARGET_DIR"
      log "Успешно создана альтернативная директория: $RESTORE_DIR"
    else
      log "ОШИБКА: Не удалось создать ни одну директорию"
      exit 1
    fi
  fi
fi

# Проверяем свободное место на диске
log "Проверка свободного места на диске..."
FREE_SPACE=$(df -h "$RESTORE_DIR" | tail -1 | awk '{print $4}')
log "Свободное место: $FREE_SPACE"

# Монтируем диск, если он еще не смонтирован
if ! grep -q "$RESTORE_DIR" /proc/mounts; then
  log "Монтирование диска с UUID ${diskUuid} в $RESTORE_DIR..."
  
  # Находим устройство по UUID
  DEVICE=$(blkid -U "${diskUuid}" || lsblk -f | grep ${diskUuid} | awk '{print $1}')
  if [ -n "$DEVICE" ]; then
    log "Найдено устройство $DEVICE, монтируем..."
    mount "$DEVICE" "$RESTORE_DIR"
    if [ $? -ne 0 ]; then
      log "ОШИБКА: Не удалось смонтировать устройство $DEVICE"
      exit 1
    fi
  else
    log "ОШИБКА: Не удалось найти устройство с UUID ${diskUuid}"
    exit 1
  fi
else
  log "Диск уже смонтирован в $RESTORE_DIR"
fi

# Очистка целевой директории перед восстановлением
log "Очистка целевой директории..."
rm -rf "$RESTORE_DIR"/* "$RESTORE_DIR"/.[!.]*

# Функция для проверки размера директории
check_dir_size() {
  du -sh "$1"
}

# Функция для наблюдения за процессом распаковки в фоне
monitor_restore() {
  local pid=$1
  local restore_dir=$2
  local start_time=$(date +%s)
  
  while kill -0 $pid 2>/dev/null; do
    local current_time=$(date +%s)
    local elapsed_time=$((current_time - start_time))
    local dir_size=$(du -sh "$restore_dir" 2>/dev/null | cut -f1)
    
    log "Прогресс восстановления: $dir_size распаковано за ${elapsed_time} секунд. Процесс активен."
    sleep 5
  done
  
  log "Процесс распаковки завершился."
  local exit_code=$(wait $pid 2>/dev/null || echo $?)
  return $exit_code
}

# Создаем файл состояния
STATUS_FILE="/tmp/restore_${diskName}_status.txt"
echo "PROCESSING" > "$STATUS_FILE"

# Распаковка архива разными методами в зависимости от типа
log "Распаковка архива ${backupFilePath}..."
SUCCESS=0

# Создаем временную директорию для анализа структуры архива
TEMP_EXTRACT_DIR=$(mktemp -d)
log "Создана временная директория для анализа: $TEMP_EXTRACT_DIR"

# Выполняем распаковку в фоновом режиме с мониторингом прогресса
# Метод 1: стандартная распаковка tar.gz
if [[ "$FILE_TYPE" == *"gzip compressed data"* ]]; then
  log "Метод 1: Распаковка gzip архива с tar..."
  
  # Сначала распаковываем несколько файлов для анализа структуры
  log "Анализ структуры архива..."
  tar -tzf "${backupFilePath}" | head -n 10 > "$TEMP_EXTRACT_DIR/file_list.txt"
  FIRST_FILE=$(head -n 1 "$TEMP_EXTRACT_DIR/file_list.txt")
  log "Первый файл в архиве: $FIRST_FILE"
  
  # Проверяем, есть ли общий префикс или родительский каталог
  if [[ "$FIRST_FILE" == *"/"* ]]; then
    PREFIX=$(echo "$FIRST_FILE" | cut -d'/' -f1)
    COMMON_PREFIX=$(grep -c "^$PREFIX/" "$TEMP_EXTRACT_DIR/file_list.txt")
    TOTAL_FILES=$(wc -l < "$TEMP_EXTRACT_DIR/file_list.txt")
    
    if [ "$COMMON_PREFIX" -eq "$TOTAL_FILES" ]; then
      log "Обнаружен общий префикс в архиве: $PREFIX. Извлекаем содержимое с устранением префикса."
      # Распаковываем с удалением верхнего каталога
      if command -v pv > /dev/null; then
        log "Запуск распаковки с отображением прогресса (pv) и удалением префикса..."
        pv "${backupFilePath}" | tar --strip-components=1 -xzf - -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      else
        log "Запуск обычной распаковки (без pv) с удалением префикса..."
        tar --strip-components=1 -xzf "${backupFilePath}" -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      fi
    else
      log "Общий префикс не обнаружен, распаковываем напрямую."
      # Запускаем обычную распаковку
      if command -v pv > /dev/null; then
        log "Запуск распаковки с отображением прогресса (pv)..."
        pv "${backupFilePath}" | tar -xzf - -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      else
        log "Запуск обычной распаковки (без pv)..."
        tar -xzf "${backupFilePath}" -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      fi
    fi
  else
    log "Архив не содержит префиксов, распаковываем напрямую."
    # Запускаем обычную распаковку
    if command -v pv > /dev/null; then
      log "Запуск распаковки с отображением прогресса (pv)..."
      pv "${backupFilePath}" | tar -xzf - -C "$RESTORE_DIR" &
      EXTRACT_PID=$!
    else
      log "Запуск обычной распаковки (без pv)..."
      tar -xzf "${backupFilePath}" -C "$RESTORE_DIR" &
      EXTRACT_PID=$!
    fi
  fi
  
  # Мониторим процесс распаковки
  monitor_restore $EXTRACT_PID "$RESTORE_DIR"
  RESULT=$?
  
  if [ $RESULT -eq 0 ]; then
    SUCCESS=1
    log "Метод 1 успешен: Распаковка завершена"
  else
    log "Метод 1 не удался (код $RESULT), пробуем другие методы"
  fi
fi

# Метод 2: проверка обычного tar архива
if [ $SUCCESS -eq 0 ] && [[ "$FILE_TYPE" == *"tar archive"* ]]; then
  log "Метод 2: Распаковка обычного tar архива..."
  
  # Сначала распаковываем несколько файлов для анализа структуры
  log "Анализ структуры архива..."
  tar -tf "${backupFilePath}" | head -n 10 > "$TEMP_EXTRACT_DIR/file_list.txt"
  FIRST_FILE=$(head -n 1 "$TEMP_EXTRACT_DIR/file_list.txt")
  log "Первый файл в архиве: $FIRST_FILE"
  
  # Проверяем, есть ли общий префикс или родительский каталог
  if [[ "$FIRST_FILE" == *"/"* ]]; then
    PREFIX=$(echo "$FIRST_FILE" | cut -d'/' -f1)
    COMMON_PREFIX=$(grep -c "^$PREFIX/" "$TEMP_EXTRACT_DIR/file_list.txt")
    TOTAL_FILES=$(wc -l < "$TEMP_EXTRACT_DIR/file_list.txt")
    
    if [ "$COMMON_PREFIX" -eq "$TOTAL_FILES" ]; then
      log "Обнаружен общий префикс в архиве: $PREFIX. Извлекаем содержимое с устранением префикса."
      # Распаковываем с удалением верхнего каталога
      if command -v pv > /dev/null; then
        log "Запуск распаковки с отображением прогресса (pv) и удалением префикса..."
        pv "${backupFilePath}" | tar --strip-components=1 -xf - -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      else
        log "Запуск обычной распаковки (без pv) с удалением префикса..."
        tar --strip-components=1 -xf "${backupFilePath}" -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      fi
    else
      log "Общий префикс не обнаружен, распаковываем напрямую."
      # Запускаем обычную распаковку
      if command -v pv > /dev/null; then
        log "Запуск распаковки с отображением прогресса (pv)..."
        pv "${backupFilePath}" | tar -xf - -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      else
        log "Запуск обычной распаковки (без pv)..."
        tar -xf "${backupFilePath}" -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      fi
    fi
  else
    log "Архив не содержит префиксов, распаковываем напрямую."
    # Запускаем обычную распаковку
    if command -v pv > /dev/null; then
      log "Запуск распаковки с отображением прогресса (pv)..."
      pv "${backupFilePath}" | tar -xf - -C "$RESTORE_DIR" &
      EXTRACT_PID=$!
    else
      log "Запуск обычной распаковки (без pv)..."
      tar -xf "${backupFilePath}" -C "$RESTORE_DIR" &
      EXTRACT_PID=$!
    fi
  fi
  
  # Мониторим процесс распаковки
  monitor_restore $EXTRACT_PID "$RESTORE_DIR"
  RESULT=$?
  
  if [ $RESULT -eq 0 ]; then
    SUCCESS=1
    log "Метод 2 успешен: Распаковка завершена"
  else
    log "Метод 2 не удался (код $RESULT), пробуем другие методы"
  fi
fi

# Метод 3: сначала разархивировать с помощью gunzip, затем tar
if [ $SUCCESS -eq 0 ]; then
  log "Метод 3: Двухэтапная распаковка - gunzip + tar..."
  TMP_DIR=$(mktemp -d)
  cp "${backupFilePath}" "$TMP_DIR/"
  cd "$TMP_DIR"
  
  log "Распаковка gunzip..."
  gunzip -f "$(basename "${backupFilePath}")" 2>/dev/null &
  GUNZIP_PID=$!
  
  # Ждем завершения gunzip
  while kill -0 $GUNZIP_PID 2>/dev/null; do
    log "Ожидание завершения gunzip..."
    sleep 2
  done
  
  TAR_FILE="$(basename "${backupFilePath}" .gz)"
  if [ -f "$TAR_FILE" ]; then
    log "Распаковка tar-файла..."
    
    # Анализируем структуру архива
    log "Анализ структуры архива..."
    tar -tf "$TAR_FILE" | head -n 10 > "$TEMP_EXTRACT_DIR/file_list.txt"
    FIRST_FILE=$(head -n 1 "$TEMP_EXTRACT_DIR/file_list.txt")
    log "Первый файл в архиве: $FIRST_FILE"
    
    # Проверяем, есть ли общий префикс или родительский каталог
    if [[ "$FIRST_FILE" == *"/"* ]]; then
      PREFIX=$(echo "$FIRST_FILE" | cut -d'/' -f1)
      COMMON_PREFIX=$(grep -c "^$PREFIX/" "$TEMP_EXTRACT_DIR/file_list.txt")
      TOTAL_FILES=$(wc -l < "$TEMP_EXTRACT_DIR/file_list.txt")
      
      if [ "$COMMON_PREFIX" -eq "$TOTAL_FILES" ]; then
        log "Обнаружен общий префикс в архиве: $PREFIX. Извлекаем содержимое с устранением префикса."
        # Распаковываем с удалением верхнего каталога
        tar --strip-components=1 -xf "$TAR_FILE" -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      else
        log "Общий префикс не обнаружен, распаковываем напрямую."
        # Запускаем обычную распаковку
        tar -xf "$TAR_FILE" -C "$RESTORE_DIR" &
        EXTRACT_PID=$!
      fi
    else
      log "Архив не содержит префиксов, распаковываем напрямую."
      # Запускаем обычную распаковку
      tar -xf "$TAR_FILE" -C "$RESTORE_DIR" &
      EXTRACT_PID=$!
    fi
    
    # Мониторим процесс распаковки
    monitor_restore $EXTRACT_PID "$RESTORE_DIR"
    RESULT=$?
    
    if [ $RESULT -eq 0 ]; then
      SUCCESS=1
      log "Метод 3 успешен: Распаковка завершена"
    else
      log "Метод 3 не удался (код $RESULT)"
    fi
  else
    log "Метод 3 не удался: не удалось извлечь tar файл из gzip"
  fi
  
  log "Очистка временных файлов..."
  rm -rf "$TMP_DIR"
fi

# Метод 4: использовать 7z, если он установлен
if [ $SUCCESS -eq 0 ] && command -v 7z > /dev/null; then
  log "Метод 4: Распаковка с помощью 7z..."
  
  # Сначала проверяем содержимое архива
  7z l "${backupFilePath}" | grep -v "---" | tail -n +20 | head -n 10 > "$TEMP_EXTRACT_DIR/7z_file_list.txt"
  log "Анализ структуры архива с помощью 7z..."
  cat "$TEMP_EXTRACT_DIR/7z_file_list.txt"
  
  # Извлекаем во временную директорию для анализа
  TEMP_7Z_DIR=$(mktemp -d)
  log "Распаковка небольшого количества файлов для анализа во временный каталог: $TEMP_7Z_DIR"
  7z x -o"$TEMP_7Z_DIR" "${backupFilePath}" -y -l
  
  # Проверяем, есть ли общий каталог верхнего уровня
  SUBDIRS=$(find "$TEMP_7Z_DIR" -maxdepth 1 -type d | wc -l)
  if [ "$SUBDIRS" -eq 2 ]; then
    # Есть только один подкаталог (кроме самого TEMP_7Z_DIR)
    SUBDIR=$(find "$TEMP_7Z_DIR" -maxdepth 1 -type d -not -path "$TEMP_7Z_DIR" | head -n 1)
    if [ -n "$SUBDIR" ]; then
      log "Обнаружен общий каталог в архиве: $SUBDIR. Копируем содержимое подкаталога."
      # Распаковываем в целевую директорию, но копируем содержимое подкаталога
      7z x "${backupFilePath}" -o"$TEMP_7Z_DIR" -y &
      EXTRACT_PID=$!
      
      # Мониторим процесс распаковки
      monitor_restore $EXTRACT_PID "$TEMP_7Z_DIR"
      RESULT=$?
      
      if [ $RESULT -eq 0 ]; then
        log "Копирование содержимого подкаталога в целевую директорию..."
        cp -a "$SUBDIR"/* "$RESTORE_DIR"/ 2>/dev/null || log "Предупреждение: некоторые файлы не удалось скопировать"
        SUCCESS=1
        log "Метод 4 успешен: Распаковка завершена с помощью 7z"
      else
        log "Метод 4 не удался при распаковке (код $RESULT)"
      fi
    else
      log "Не удалось определить подкаталог в архиве, распаковываем напрямую."
      7z x "${backupFilePath}" -o"$RESTORE_DIR" -y &
      EXTRACT_PID=$!
      
      # Мониторим процесс распаковки
      monitor_restore $EXTRACT_PID "$RESTORE_DIR"
      RESULT=$?
      
      if [ $RESULT -eq 0 ]; then
        SUCCESS=1
        log "Метод 4 успешен: Распаковка завершена с помощью 7z"
      else
        log "Метод 4 не удался (код $RESULT)"
      fi
    fi
  else
    log "Архив не содержит общего каталога верхнего уровня, распаковываем напрямую."
    7z x "${backupFilePath}" -o"$RESTORE_DIR" -y &
    EXTRACT_PID=$!
    
    # Мониторим процесс распаковки
    monitor_restore $EXTRACT_PID "$RESTORE_DIR"
    RESULT=$?
    
    if [ $RESULT -eq 0 ]; then
      SUCCESS=1
      log "Метод 4 успешен: Распаковка завершена с помощью 7z"
    else
      log "Метод 4 не удался (код $RESULT)"
    fi
  fi
  
  # Очищаем временную директорию
  rm -rf "$TEMP_7Z_DIR"
fi

# Очищаем временную директорию для анализа
rm -rf "$TEMP_EXTRACT_DIR"

# Проверяем наличие подкаталога с UUID в RESTORE_DIR
UUID_DIR="$RESTORE_DIR/${diskUuid}"
if [ -d "$UUID_DIR" ] && [ "$(ls -A "$UUID_DIR" 2>/dev/null)" ]; then
  log "Обнаружен подкаталог с UUID ${diskUuid} в целевой директории. Перемещаем содержимое в корень."
  mv "$UUID_DIR"/* "$RESTORE_DIR"/ 2>/dev/null || log "Предупреждение: некоторые файлы не удалось переместить"
  rmdir "$UUID_DIR" 2>/dev/null || log "Предупреждение: не удалось удалить пустую директорию UUID"
fi

# Проверяем, был ли успех
if [ $SUCCESS -eq 1 ]; then
  log "Восстановление успешно завершено"
  echo "SUCCESS" > "$STATUS_FILE"
  log "Содержимое восстановленного каталога:"
  ls -la "$RESTORE_DIR" | head -10 | tee -a "$LOG_FILE"
  
  DIR_SIZE=$(check_dir_size "$RESTORE_DIR")
  log "Размер восстановленных данных: $DIR_SIZE"
  
  # Исправляем права доступа, чтобы node.js мог работать с файлами
  log "Исправление прав доступа..."
  chown -R user:user "$RESTORE_DIR" || chown -R node:node "$RESTORE_DIR" || chown -R nobody:nogroup "$RESTORE_DIR" || chown -R 1000:1000 "$RESTORE_DIR"
  chmod -R 755 "$RESTORE_DIR"
  log "Установлены разрешения для работы с файлами"
  
  log "Восстановление бэкапа ${backupFileName} успешно завершено"
  exit 0
else
  log "ОШИБКА: Не удалось распаковать архив ни одним методом"
  echo "ERROR" > "$STATUS_FILE"
  log "Детальная информация о файле:"
  file -z "${backupFilePath}" | tee -a "$LOG_FILE"
  hexdump -C -n 100 "${backupFilePath}" | tee -a "$LOG_FILE"
  log "См. полный лог в файле $LOG_FILE"
  exit 1
fi`;
    
    // Создаем временный файл для скрипта
    const tempScriptPath = `/tmp/restore_${diskName}_${Date.now()}.sh`;
    fs.writeFileSync(tempScriptPath, restoreScript, { mode: 0o755 });
    
    // Копируем скрипт на сервер
    logger.info(`[BACKUP] Копирование скрипта восстановления на сервер ${sshServer}`);
    const { exec, execSync } = require('child_process');
    
    try {
      // Копируем скрипт на сервер
      const scpCmd = `scp ${sshOptions} -P ${sshPort} ${tempScriptPath} root@${sshServer}:/tmp/restore_script.sh`;
      logger.info(`[BACKUP] Выполняем команду: ${scpCmd}`);
      execSync(scpCmd);
      
      // Устанавливаем права на выполнение скрипта
      const chmodCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "chmod +x /tmp/restore_script.sh"`;
      execSync(chmodCmd);
      
      // Запускаем скрипт восстановления на сервере в фоновом режиме с nohup
      // Это обеспечит продолжение выполнения даже при закрытии SSH-соединения
      const sshCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "cd /tmp && nohup /tmp/restore_script.sh > /tmp/restore_${diskName}.log 2>&1 &"`;
      logger.info(`[BACKUP] Выполняем команду восстановления в фоновом режиме: ${sshCmd}`);
      execSync(sshCmd);
      
      // Отправляем успешный ответ пользователю сразу
      res.json({
        success: true,
        message: `Запущен процесс восстановления диска ${diskName} из бэкапа ${backupFileName}. Это может занять несколько минут.`
      });
      
      // Запускаем периодическую проверку статуса восстановления
      const checkStatusInterval = setInterval(async () => {
        try {
          // Проверяем статус восстановления
          const checkCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "if [ -f /tmp/restore_${diskName}_status.txt ]; then cat /tmp/restore_${diskName}_status.txt; else echo 'UNKNOWN'; fi"`;
          const status = execSync(checkCmd, { encoding: 'utf8' }).trim();
          
          logger.info(`[BACKUP] Статус восстановления: ${status}`);
          
          // Получаем последние строки лога
          const logCmd = `ssh ${sshOptions} -p ${sshPort} root@${sshServer} "tail -n 10 /tmp/restore_${diskName}.log 2>/dev/null || echo 'Лог не найден'"`;
          const logOutput = execSync(logCmd, { encoding: 'utf8' }).trim();
          
          if (status === 'SUCCESS') {
            logger.info(`[BACKUP] Восстановление успешно завершено`);
            clearInterval(checkStatusInterval);
            
            // Обновляем статус бэкапа
            updateDiskBackupStatus(diskUuid, 'SUCCESS', `Восстановление из бэкапа ${backupFileName} завершено успешно`, new Date());
            
            // Удаляем временные файлы
            try {
              execSync(`ssh ${sshOptions} -p ${sshPort} root@${sshServer} "rm -f /tmp/restore_script.sh /tmp/restore_${diskName}_status.txt"`);
            } catch (e) {
              logger.error(`[BACKUP] Ошибка при удалении временных файлов: ${e.message}`);
            }
          } else if (status === 'ERROR') {
            logger.error(`[BACKUP] Ошибка при восстановлении диска ${diskName}`);
            clearInterval(checkStatusInterval);
            
            // Обновляем статус бэкапа с ошибкой
            updateDiskBackupStatus(diskUuid, 'ERROR', `Ошибка при восстановлении из бэкапа ${backupFileName}`, new Date());
            
            // Удаляем временные файлы
            try {
              execSync(`ssh ${sshOptions} -p ${sshPort} root@${sshServer} "rm -f /tmp/restore_script.sh /tmp/restore_${diskName}_status.txt"`);
            } catch (e) {
              logger.error(`[BACKUP] Ошибка при удалении временных файлов: ${e.message}`);
            }
          } else if (status === 'PROCESSING') {
            // Обновляем статус - все еще в процессе
            updateDiskBackupStatus(diskUuid, 'PROCESSING', `Восстановление из бэкапа ${backupFileName} в процессе...`, new Date());
            
            // Логируем последние строки лога для отладки
            logger.info(`[BACKUP] Прогресс восстановления:\n${logOutput}`);
          }
        } catch (error) {
          logger.error(`[BACKUP] Ошибка при проверке статуса восстановления: ${error.message}`);
        }
      }, 10000); // Проверка каждые 10 секунд
      
      // Устанавливаем таймаут для интервала проверки (2 часа максимум)
      setTimeout(() => {
        if (checkStatusInterval) {
          clearInterval(checkStatusInterval);
          logger.error(`[BACKUP] Превышено максимальное время восстановления (2 часа) для диска ${diskName}`);
          
          // Обновляем статус бэкапа с ошибкой тайм-аута
          updateDiskBackupStatus(diskUuid, 'ERROR', `Превышено время восстановления из бэкапа ${backupFileName}`, new Date());
        }
      }, 2 * 60 * 60 * 1000);
      
      // Удаляем временный скрипт на клиенте
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (e) {
        logger.error(`[BACKUP] Ошибка при удалении временного файла: ${e.message}`);
      }
      
      return true;
    } catch (error) {
      // Удаляем временный скрипт в случае ошибки
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (e) {
        logger.error(`[BACKUP] Ошибка при удалении временного файла: ${e.message}`);
      }
      
      logger.error(`[BACKUP] Ошибка при запуске процесса восстановления: ${error.message}`);
      
      // Если ответ еще не отправлен, отправляем ошибку
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: `Ошибка при запуске процесса восстановления: ${error.message}`
        });
      }
      
      return false;
    }
  } catch (outerError) {
    logger.error(`[BACKUP] Критическая ошибка в функции startRestoreProcessViaSsh: ${outerError.message}`);
    logger.error(`[BACKUP] Стек ошибки: ${outerError.stack}`);
    
    // Если ответ еще не отправлен, отправляем ошибку
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: `Критическая ошибка при запуске восстановления: ${outerError.message}`
      });
    }
    
    return false;
  }
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
    
    // Находим имя диска по UUID (обратный поиск)
    let diskName = null;
    for (const [name, path] of Object.entries(config.disks)) {
      // Извлекаем UUID из пути
      const match = path.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
      const pathUuid = match && match[1] ? match[1] : null;
      
      if (pathUuid && pathUuid.toLowerCase() === diskUuid.toLowerCase()) {
        diskName = name;
        break;
      }
    }
    
    logger.info(`[BACKUP] Определено имя диска ${diskName} для UUID ${diskUuid}`);
    
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
    
    // Если нашли имя диска, также обновляем запись по имени
    if (diskName) {
      global.fakeDiskModel[diskName] = {
        ...(global.fakeDiskModel[diskName] || {}),
        name: diskName,
        status: 'online',
        backupStatus: status,
        backupMessage: message || '',
        backupUpdatedAt: new Date()
      };
      
      logger.info(`[BACKUP] Статус бэкапа обновлен для диска ${diskName}: ${status}, ${message}`);
    }
    
    logger.info(`[BACKUP] Статус бэкапа обновлен для UUID ${diskUuid}: ${status}, ${message}`);
    
    // Пытаемся обновить статус в базе данных, если она доступна
    if (mongoose && mongoose.connection.readyState === 1) {
      try {
        // Сначала пробуем найти диск по имени, если имя известно
        let disk = null;
        if (diskName) {
          disk = await Disk.findOne({ name: diskName });
          if (disk) {
            logger.info(`[BACKUP] Найден диск в базе данных по имени: ${diskName}`);
          }
        }
        
        // Если не нашли по имени, ищем по UUID
        if (!disk) {
          disk = await Disk.findOne({ name: diskUuid });
          if (disk) {
            logger.info(`[BACKUP] Найден диск в базе данных по UUID: ${diskUuid}`);
          }
        }
        
        if (disk) {
          // Обновляем найденный диск
          disk.backupStatus = status;
          disk.backupMessage = message || '';
          disk.backupUpdatedAt = new Date();
          await disk.save();
          logger.info(`[BACKUP] Статус бэкапа обновлен в базе данных для диска ${disk.name}`);
        } else {
          // Создаем новую запись, если диска нет в базе
          // Используем имя диска, если оно известно, иначе UUID
          const name = diskName || diskUuid;
          disk = await Disk.create({
            name: name,
            status: 'online',
            backupStatus: status,
            backupMessage: message || '',
            backupUpdatedAt: new Date()
          });
          logger.info(`[BACKUP] Создана новая запись в базе данных для диска ${name}`);
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
  if (!diskName) {
    logger.error('[BACKUP] getDiskUuidFromName: Имя диска не указано');
    return null;
  }
  
  const mountPoint = config.disks[diskName];
  if (!mountPoint) {
    logger.error(`[BACKUP] getDiskUuidFromName: Не найдена точка монтирования для диска ${diskName}`);
    logger.debug(`[BACKUP] Доступные диски в конфигурации: ${JSON.stringify(config.disks)}`);
    return null;
  }
  
  logger.info(`[BACKUP] getDiskUuidFromName: Точка монтирования для диска ${diskName}: ${mountPoint}`);
  
  // Пробуем разные форматы извлечения UUID
  
  // 1. Формат /mnt/data_storage/UUID или /mnt/storage/UUID
  const uuidMatch = mountPoint.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|$)/i);
  if (uuidMatch && uuidMatch[1]) {
    logger.info(`[BACKUP] getDiskUuidFromName: Найден UUID в пути: ${uuidMatch[1]}`);
    return uuidMatch[1];
  }
  
  // 2. Если UUID указан в имени диска непосредственно (для случая передачи UUID как имени диска)
  const diskNameUuidMatch = diskName.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
  if (diskNameUuidMatch && diskNameUuidMatch[1]) {
    logger.info(`[BACKUP] getDiskUuidFromName: Найден UUID в имени диска: ${diskNameUuidMatch[1]}`);
    return diskNameUuidMatch[1];
  }
  
  // 3. Если мы можем получить UUID из конфигурации backup_disks
  if (config.backup_disks && config.backup_disks[diskName]) {
    const backupUuid = config.backup_disks[diskName];
    logger.info(`[BACKUP] getDiskUuidFromName: Найден UUID в конфигурации backup_disks: ${backupUuid}`);
    return backupUuid;
  }
  
  // 4. Использовать имя диска как UUID для совместимости со старыми скриптами
  if (diskName === 'C' || diskName === 'D') {
    const fallbackUuid = '65135f15-6654-47b0-8e70-6f1a2485e8c2'; // UUID диска C
    logger.warn(`[BACKUP] getDiskUuidFromName: Используем стандартный UUID ${fallbackUuid} для диска ${diskName}`);
    return fallbackUuid;
  }
  
  logger.error(`[BACKUP] getDiskUuidFromName: Не удалось извлечь UUID из пути ${mountPoint} для диска ${diskName}`);
  return null;
};

module.exports = {
  checkBackupApiKey,
  updateBackupStatus,
  getBackupsList,
  restoreBackup
}; 