const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const archiver = require('archiver');
const config = require('../config/config');
const logger = require('../utils/logger');
const tempStorage = require('../utils/tempStorage');

const execPromise = util.promisify(exec);

/**
 * Middleware для проверки доступности диска перед выполнением операций
 */
const validateDiskAccess = (req, res, next) => {
  const { disk } = req.params;
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка доступа к несуществующему диску: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  // Проверяем статус монтирования из глобального состояния
  if (!global.mountedDisks[disk]) {
    logger.error(`Попытка доступа к несмонтированному диску: ${disk}`);
    return res.status(503).json({ 
      error: 'Диск не смонтирован или недоступен', 
      status: 'offline'
    });
  }
  
  next();
};

/**
 * Получение списка файлов в директории
 */
const getFiles = (req, res, next) => {
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  
  // Проверка доступности диска сначала
  if (!global.mountedDisks[disk]) {
    logger.error(`Попытка получения файлов с несмонтированного диска: ${disk}`);
    return res.status(503).json({ 
      error: 'Диск не смонтирован или недоступен', 
      status: 'offline'
    });
  }
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка доступа к несуществующему диску: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(config.disks[disk], folderPath);
  logger.info(`Запрос списка файлов: ${disk}:${folderPath} (полный путь: ${fullPath})`);
  
  // Дополнительная проверка доступа к директории
  fs.access(fullPath, fs.constants.F_OK | fs.constants.R_OK, (err) => {
    if (err) {
      logger.error(`Ошибка доступа к директории: ${fullPath}`, err);
      
      // Если директория недоступна, проверяем состояние диска
      execPromise(`df "${config.disks[disk]}" | grep "${config.disks[disk]}"`)
        .catch(() => {
          // Если произошла ошибка при проверке df, помечаем диск как недоступный
          global.mountedDisks[disk] = false;
        });
      
      return res.status(404).json({ 
        error: 'Директория не найдена или нет прав на чтение',
        path: folderPath
      });
    }
    
    // Получаем список файлов
    fs.readdir(fullPath, { withFileTypes: true }, (err, files) => {
      if (err) {
        logger.error(`Ошибка при чтении директории: ${fullPath}`, err);
        return res.status(500).json({ error: 'Не удалось прочитать директорию' });
      }
      
      try {
        // Фильтруем файлы, удаляя .tmp_chunks и .disk_uuid
        const filteredFiles = files.filter(file => {
          // Исключаем системные файлы и файл со звездочкой (*)
          return !file.name.includes('.tmp_chunks') && 
                 file.name !== '.disk_uuid' && 
                 file.name !== '*';
        });
        
        // Для лучшей отладки логируем содержимое директории
        logger.info(`Найдено ${files.length} файлов в директории ${fullPath}, отображается ${filteredFiles.length} после фильтрации`);
        
        // Массив для хранения промисов получения размеров файлов
        const fileSizePromises = filteredFiles.map(file => {
          const isDirectory = file.isDirectory();
          const filePath = path.join(fullPath, file.name);
          
          return new Promise(resolve => {
            if (isDirectory) {
              resolve({
                name: file.name,
                isDirectory: true,
                size: 0,
                path: path.join(folderPath, file.name)
              });
            } else {
              // Используем более точный способ получения размера файла
              exec(`du -sk "${filePath}" | cut -f1`, (error, stdout) => {
                let fileSize = 0;
                
                if (error) {
                  logger.warn(`Ошибка при получении размера для ${filePath}`, error);
                  try {
                    const stats = fs.statSync(filePath);
                    fileSize = stats.size;
                  } catch (statError) {
                    logger.error(`Не удалось получить размер файла ${filePath}`, statError);
                  }
                } else {
                  // Преобразуем килобайты в байты для согласованности
                  fileSize = parseInt(stdout.trim(), 10) * 1024;
                }
                
                resolve({
                  name: file.name,
                  isDirectory: false,
                  size: fileSize,
                  path: path.join(folderPath, file.name)
                });
              });
            }
          });
        });
        
        // Дожидаемся завершения всех промисов
        Promise.all(fileSizePromises).then(filesList => {
          logger.info(`Отправка списка из ${filesList.length} файлов и папок`);
          res.json(filesList);
        }).catch(error => {
          logger.error(`Ошибка при обработке размеров файлов: ${fullPath}`, error);
          next(error);
        });
      } catch (error) {
        logger.error(`Ошибка при обработке списка файлов: ${fullPath}`, error);
        next(error);
      }
    });
  });
};

/**
 * Загрузка файла
 */
/**
 * Загрузка файла
 */
const uploadFile = (req, res) => {
  if (!req.file) {
    logger.warn('Попытка загрузки без файла');
    return res.status(400).json({ error: 'Файл не был загружен' });
  }
  
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  const fileInfo = {
    name: req.file.filename || req.file.originalname,
    size: req.file.size,
    path: path.join(folderPath, req.file.filename || req.file.originalname),
    mimetype: req.file.mimetype,
    uploadedAt: new Date()
  };
  
  logger.info(`Файл загружен: ${disk}:${fileInfo.path} (${req.file.size} байт)`);
  
  res.json({ 
    success: true, 
    message: 'Файл успешно загружен',
    file: fileInfo
  });
};

/**
 * Удаление файла или директории
 */
const deleteFile = (req, res, next) => {
  const { disk } = req.params;
  const { filePath } = req.body;
  
  // Защита от удаления системных файлов
  if (filePath.includes('.tmp_chunks') || filePath === '.disk_uuid') {
    logger.warn(`Попытка удаления системного файла: ${filePath}`);
    return res.status(403).json({ 
      success: false,
      error: 'Системные файлы не могут быть удалены',
      protectedFile: true
    });
  }
  
  // Проверка на права администратора
  if (!req.user.isAdmin) {
    logger.warn(`Попытка удаления файла без прав администратора: ${req.user.username}`);
    return res.status(403).json({ 
      success: false,
      error: 'Недостаточно прав для удаления. Запросите разрешение у администратора',
      requiresAdmin: true
    });
  }
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка удаления файла на несуществующем диске: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(config.disks[disk], filePath);
  logger.info(`Запрос на удаление: ${disk}:${filePath}`);
  
  fs.stat(fullPath, (err, stats) => {
    if (err) {
      logger.warn(`Попытка удаления несуществующего файла: ${fullPath}`, err);
      return res.status(404).json({ error: 'Файл не найден' });
    }
    
    try {
      if (stats.isDirectory()) {
        fs.rmdir(fullPath, { recursive: true }, (err) => {
          if (err) {
            logger.error(`Ошибка при удалении директории: ${fullPath}`, err);
            return res.status(500).json({ error: 'Не удалось удалить директорию' });
          }
          logger.info(`Директория удалена: ${disk}:${filePath}`);
          res.json({ success: true, message: 'Директория успешно удалена' });
        });
      } else {
        fs.unlink(fullPath, (err) => {
          if (err) {
            logger.error(`Ошибка при удалении файла: ${fullPath}`, err);
            return res.status(500).json({ error: 'Не удалось удалить файл' });
          }
          logger.info(`Файл удален: ${disk}:${filePath}`);
          res.json({ success: true, message: 'Файл успешно удален' });
        });
      }
    } catch (error) {
      next(error);
    }
  });
};

/**
 * Создание новой папки
 */
const createFolder = (req, res, next) => {
  const { disk } = req.params;
  const { folderPath, folderName } = req.body;
  
  if (!folderName || typeof folderName !== 'string') {
    logger.warn(`Попытка создания папки с недопустимым именем: ${folderName}`);
    return res.status(400).json({ error: 'Недопустимое имя папки' });
  }
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка создания папки на несуществующем диске: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  // Очищаем имя папки от недопустимых символов
  const sanitizedFolderName = folderName.replace(/[/\\?%*:|"<>]/g, '');
  if (sanitizedFolderName !== folderName) {
    logger.warn(`Имя папки содержало недопустимые символы: ${folderName} -> ${sanitizedFolderName}`);
  }
  
  const fullPath = path.join(config.disks[disk], folderPath || '', sanitizedFolderName);
  logger.info(`Запрос на создание папки: ${disk}:${path.join(folderPath || '', sanitizedFolderName)} (полный путь: ${fullPath})`);
  
  try {
    // Сперва пробуем создать папку напрямую без sudo
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      logger.info(`Папка создана: ${disk}:${path.join(folderPath || '', sanitizedFolderName)}`);
      return res.json({ success: true, message: 'Директория успешно создана' });
    } else {
      logger.warn(`Папка уже существует: ${fullPath}`);
      return res.status(409).json({ error: 'Папка с таким именем уже существует' });
    }
  } catch (error) {
    logger.error(`Ошибка при создании директории напрямую: ${fullPath}`, error);
    
    // Если не удалось создать напрямую, пробуем через sudo скрипт
    exec(`sudo /usr/local/bin/create-folder.sh "${fullPath}"`, (err, stdout, stderr) => {
      if (err) {
        logger.error(`Ошибка при создании директории через sudo: ${fullPath}`, { error: err, stderr });
        return res.status(500).json({ error: 'Не удалось создать директорию' });
      }
      
      logger.info(`Папка создана через sudo: ${disk}:${path.join(folderPath || '', sanitizedFolderName)}`);
      res.json({ success: true, message: 'Директория успешно создана' });
    });
  }
};

/**
 * Скачивание файла или папки
 */
const downloadFile = (req, res, next) => {
  const { disk } = req.params;
  const filePath = req.query.path || '';
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка скачивания с несуществующего диска: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(config.disks[disk], filePath);
  logger.info(`Запрос на скачивание: ${disk}:${filePath}`);
  
  fs.stat(fullPath, (err, stats) => {
    if (err) {
      logger.error(`Ошибка при доступе к файлу: ${fullPath}`, err);
      return res.status(404).json({ error: 'Файл не найден' });
    }
    
    try {
      if (stats.isDirectory()) {
        // Если это директория, создаем zip-архив
        const archiveName = path.basename(filePath) || 'archive';
        const zipFilePath = path.join('/tmp', `${archiveName}-${Date.now()}.zip`);
        
        logger.info(`Архивирование директории: ${fullPath} -> ${zipFilePath}`);
        
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
          zlib: { level: 9 } // Максимальный уровень сжатия
        });
        
        output.on('close', () => {
          logger.info(`Архив создан: ${zipFilePath} (${archive.pointer()} байт)`);
          
          res.download(zipFilePath, `${archiveName}.zip`, (err) => {
            if (err) {
              logger.error(`Ошибка при отправке архива: ${zipFilePath}`, err);
            }
            
            // Удаляем временный архив после отправки
            fs.unlink(zipFilePath, (err) => {
              if (err) logger.warn(`Ошибка при удалении временного архива: ${zipFilePath}`, err);
            });
          });
        });
        
        archive.on('error', (err) => {
          logger.error(`Ошибка при создании архива: ${fullPath}`, err);
          res.status(500).json({ error: 'Ошибка при создании архива' });
        });
        
        archive.pipe(output);
        archive.directory(fullPath, false);
        archive.finalize();
      } else {
        // Если это файл, отправляем его напрямую
        logger.info(`Отправка файла: ${fullPath} (${stats.size} байт)`);
        
        res.download(fullPath, path.basename(filePath), (err) => {
          if (err) {
            logger.error(`Ошибка при скачивании файла: ${fullPath}`, err);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Ошибка при скачивании файла' });
            }
          }
        });
      }
    } catch (error) {
      next(error);
    }
  });
};

// Метод для очистки статуса загрузки для конкретного файла
const clearFileUploadStatus = (req, res) => {
  const { disk } = req.params;
  const { path: filePath, filename } = req.body;
  
  if (!global.activeUploads) {
    global.activeUploads = new Map();
    logger.info('Инициализирован новый объект активных загрузок');
    return res.json({ success: true, message: 'Статус загрузки очищен' });
  }
  
  if (!disk) {
    return res.status(400).json({ success: false, error: 'Не указан ID диска' });
  }
  
  const folderPath = filePath || '';
  
  if (filename) {
    // Очищаем статус для конкретного файла
    const uploadKey = `${disk}:${folderPath}:${filename}`;
    const removed = global.activeUploads.delete(uploadKey);
    
    if (removed) {
      logger.info(`Очищен статус загрузки для файла: ${disk}:${folderPath}/${filename}`);
      return res.json({ 
        success: true, 
        message: `Статус загрузки для файла ${filename} очищен` 
      });
    } else {
      logger.info(`Файл не найден в активных загрузках: ${disk}:${folderPath}/${filename}`);
      return res.json({ 
        success: true, 
        message: `Файл ${filename} не найден в активных загрузках` 
      });
    }
  } else {
    // Очищаем все файлы в указанной директории
    let count = 0;
    
    for (const [key, upload] of global.activeUploads.entries()) {
      if (key.startsWith(`${disk}:${folderPath}:`)) {
        global.activeUploads.delete(key);
        count++;
      }
    }
    
    logger.info(`Очищено ${count} записей о загрузках для директории ${disk}:${folderPath}`);
    return res.json({ 
      success: true, 
      message: `Очищено ${count} записей о загрузках` 
    });
  }
};

// Новый API endpoint для синхронизации файлов с клиента на сервер
const synchronizeFile = async (req, res, next) => {
  try {
    const { disk } = req.params;
    const { fileId, originalName, size, lastModified, folderPath } = req.body;
    
    if (!fileId || !originalName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Отсутствуют необходимые параметры: fileId и originalName' 
      });
    }
    
    // Проверяем доступность диска
    if (!config.disks[disk]) {
      logger.warn(`Попытка синхронизации с несуществующим диском: ${disk}`);
      return res.status(404).json({ error: 'Диск не найден' });
    }
    
    if (!global.mountedDisks[disk]) {
      logger.error(`Попытка синхронизации с несмонтированным диском: ${disk}`);
      return res.status(503).json({ 
        success: false,
        error: 'Диск не смонтирован или недоступен', 
        status: 'offline'
      });
    }
    
    // Проверяем наличие данных файла в запросе
    if (!req.file) {
      logger.warn('Попытка синхронизации без файла');
      return res.status(400).json({ 
        success: false,
        error: 'Файл не был загружен' 
      });
    }
    
    // Формируем путь для сохранения файла
    const targetPath = path.join(
      config.disks[disk], 
      folderPath || '',
      originalName
    );
    
    // Отправляем немедленный ответ клиенту, что запрос принят
    res.json({
      success: true,
      message: 'Файл принят для синхронизации',
      syncStatus: 'in_progress',
      fileId,
      file: {
        name: originalName,
        size: req.file.size,
        path: path.join(folderPath || '', originalName),
        syncStarted: new Date().toISOString()
      }
    });
    
    // Добавляем задачу синхронизации в глобальный трекер
    if (!global.syncTasks) {
      global.syncTasks = new Map();
    }
    
    // Регистрируем задачу
    const syncTask = {
      fileId,
      disk,
      sourcePath: req.file.path,
      targetPath,
      folderPath: folderPath || '',
      originalName,
      size: req.file.size,
      startTime: Date.now(),
      status: 'copying',
      progress: 0
    };
    
    global.syncTasks.set(fileId, syncTask);
    
    // Выполняем копирование файла из временной директории в целевую
    try {
      // Создаем директорию назначения, если она не существует
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        await fsPromises.mkdir(targetDir, { recursive: true });
      }
      
      // Выполняем копирование файла
      await fsPromises.copyFile(req.file.path, targetPath);
      
      // Обновляем статус задачи
      syncTask.status = 'completed';
      syncTask.progress = 100;
      syncTask.completedAt = Date.now();
      global.syncTasks.set(fileId, syncTask);
      
      logger.info(`Синхронизация файла успешно завершена: ${fileId} -> ${targetPath}`);
      
      // Удаляем временный файл
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) {
          logger.warn(`Не удалось удалить временный файл: ${req.file.path}`, unlinkErr);
        }
      });
      
      // Удаляем задачу через некоторое время
      setTimeout(() => {
        if (global.syncTasks.has(fileId)) {
          global.syncTasks.delete(fileId);
        }
      }, 30 * 60 * 1000); // 30 минут
      
    } catch (error) {
      logger.error(`Ошибка при синхронизации файла: ${fileId}`, error);
      
      // Обновляем статус задачи
      syncTask.status = 'error';
      syncTask.error = error.message;
      syncTask.failedAt = Date.now();
      global.syncTasks.set(fileId, syncTask);
    }
    
  } catch (error) {
    logger.error('Критическая ошибка при синхронизации файла:', error);
    // Если ответ еще не отправлен, отправляем ошибку
    if (!res.headersSent) {
      next(error);
    }
  }
};

// API для проверки статуса синхронизации
const getSyncStatus = (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Не указан ID файла' 
      });
    }
    
    if (!global.syncTasks) {
      global.syncTasks = new Map();
    }
    
    // Проверяем наличие задачи в трекере
    if (global.syncTasks.has(fileId)) {
      const task = global.syncTasks.get(fileId);
      
      return res.json({
        success: true,
        sync: {
          fileId,
          status: task.status,
          progress: task.progress,
          startTime: task.startTime,
          completedAt: task.completedAt,
          error: task.error
        }
      });
    } else {
      // Если задача не найдена, проверяем существование файла
      const { disk, path: filePath } = req.query;
      
      if (disk && filePath && config.disks[disk]) {
        const fullPath = path.join(config.disks[disk], filePath);
        
        fs.access(fullPath, fs.constants.F_OK, (err) => {
          if (err) {
            return res.json({
              success: true,
              sync: {
                fileId,
                status: 'not_found',
                error: 'Файл не найден или синхронизация не выполнялась'
              }
            });
          } else {
            // Файл существует, значит синхронизация была успешной
            return res.json({
              success: true,
              sync: {
                fileId,
                status: 'completed',
                progress: 100,
                message: 'Файл успешно синхронизирован'
              }
            });
          }
        });
      } else {
        return res.json({
          success: true,
          sync: {
            fileId,
            status: 'unknown',
            message: 'Синхронизация не найдена или завершена'
          }
        });
      }
    }
  } catch (error) {
    logger.error('Ошибка при получении статуса синхронизации:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при получении статуса синхронизации' 
    });
  }
};

// API для отмены синхронизации
const cancelSync = (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Не указан ID файла' 
      });
    }
    
    if (!global.syncTasks) {
      global.syncTasks = new Map();
    }
    
    // Проверяем наличие задачи в трекере
    if (global.syncTasks.has(fileId)) {
      const task = global.syncTasks.get(fileId);
      
      // Проверяем, можно ли отменить синхронизацию
      if (task.status === 'completed' || task.status === 'error') {
        return res.json({
          success: true,
          message: `Синхронизация уже ${task.status === 'completed' ? 'завершена' : 'завершилась с ошибкой'}`
        });
      }
      
      // Отмечаем задачу как отмененную
      task.status = 'cancelled';
      task.cancelledAt = Date.now();
      global.syncTasks.set(fileId, task);
      
      // Удаляем целевой файл, если он существует
      if (task.targetPath && fs.existsSync(task.targetPath)) {
        fs.unlink(task.targetPath, (err) => {
          if (err) {
            logger.warn(`Не удалось удалить целевой файл при отмене синхронизации: ${task.targetPath}`, err);
          }
        });
      }
      
      logger.info(`Синхронизация отменена: ${fileId}`);
      
      return res.json({
        success: true,
        message: 'Синхронизация успешно отменена'
      });
    } else {
      return res.json({
        success: true,
        message: 'Синхронизация не найдена или уже завершена'
      });
    }
  } catch (error) {
    logger.error('Ошибка при отмене синхронизации:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при отмене синхронизации' 
    });
  }
};


module.exports = {
  getFiles,
  uploadFile,
  deleteFile,
  createFolder,
  downloadFile,
  clearFileUploadStatus,
  synchronizeFile,
  getSyncStatus,
  cancelSync
};