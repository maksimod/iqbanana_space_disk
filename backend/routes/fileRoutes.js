const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config/config');
const logger = require('../utils/logger');

// Глобальный трекер активных загрузок
const activeUploads = new Map();

// Используем middleware для проверки доступности диска
// Это предотвратит любые операции с несмонтированными дисками
router.use('/:disk', (req, res, next) => {
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
});

// Маршрут для получения списка файлов
router.get('/:disk/files', fileController.getFiles);

// Маршрут для проверки статуса загрузки
router.get('/:disk/upload-status', (req, res) => {
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  
  const diskUploads = Array.from(global.activeUploads.entries())
    .filter(([key]) => key.startsWith(`${disk}:${folderPath}:`))
    .map(([key, value]) => ({
      filename: key.split(':')[2],
      status: value.status,
      progress: value.progress,
      startedAt: value.startedAt
    }));
  
  // Устанавливаем заголовки для предотвращения кэширования
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  res.json({ uploads: diskUploads });
});

// Прямая и быстрая загрузка файлов
router.post('/:disk/upload', (req, res) => {
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  
  // Флаги для отслеживания состояния загрузки
  const uploadState = {
    completed: false,
    aborted: false,
    processing: false,
    progress: 0
  };
  
  // Обработчик закрытия соединения
  req.on('close', () => {
    if (!uploadState.completed && uploadState.processing) {
      uploadState.aborted = true;
      logger.warn(`Соединение закрыто клиентом при загрузке файла на диск ${disk}`);
      
      // Не удаляем запись из активных загрузок, чтобы продолжить обработку
      // файл будет сохранен даже если клиент отключится
    }
  });
  
  // Дополнительная проверка перед загрузкой
  if (!global.mountedDisks[disk]) {
    logger.error(`Попытка загрузки на несмонтированный диск: ${disk}`);
    return res.status(503).json({ 
      error: 'Диск не смонтирован или недоступен', 
      status: 'offline'
    });
  }
  
  const fullPath = path.join(config.disks[disk], folderPath);
  
  // Настройка хранилища multer
  const storage = multer.diskStorage({
    destination: function(req, file, cb) {
      fs.access(fullPath, fs.constants.F_OK | fs.constants.W_OK, (err) => {
        if (err) {
          logger.error(`Ошибка доступа к директории для загрузки: ${fullPath}`, err);
          return cb(new Error('Директория не существует или нет прав на запись'));
        }
        
        // Добавляем информацию о загрузке в трекер
        const uploadKey = `${disk}:${folderPath}:${file.originalname}`;
        activeUploads.set(uploadKey, {
          status: 'uploading',
          progress: 0,
          startedAt: new Date(),
          temporary: false
        });
        
        cb(null, fullPath);
      });
    },
    filename: function(req, file, cb) {
      // Проверяем, не идет ли уже загрузка такого файла
      const uploadKey = `${disk}:${folderPath}:${file.originalname}`;
      const existingUpload = activeUploads.get(uploadKey);
      
      // Вместо ошибки, просто удаляем предыдущую запись и разрешаем новую загрузку
      if (existingUpload && existingUpload.status === 'uploading' && !existingUpload.temporary) {
        logger.warn(`Найдена существующая загрузка для файла ${file.originalname}, удаляем её и разрешаем новую`);
        activeUploads.delete(uploadKey);
      }
      
      cb(null, file.originalname);
    }
  });
  
  // Настраиваем multer
  const upload = multer({ 
    storage,
    limits: { 
      fileSize: config.performance.maxFileSize || 20 * 1024 * 1024 * 1024
    }
  }).single('file');
  
  // Устанавливаем увеличенные таймауты
  req.setTimeout(3600000);
  res.setTimeout(3600000);
  
  logger.info(`Начало обработки загрузки файла на диск ${disk}:${folderPath}`);
  uploadState.processing = true;
  
  // Выполняем загрузку
  upload(req, res, function(err) {
    logger.info(`Завершение обработки multer для диска ${disk}`);
    uploadState.processing = false;
    uploadState.completed = true;
    
    if (uploadState.aborted) {
      logger.warn(`Загрузка была прервана клиентом для диска ${disk}, но файл будет сохранен`);
      // Продолжаем обработку даже при закрытии соединения клиентом
    }
    
    if (err) {
      logger.error(`Ошибка при загрузке файла: ${err.message}`);
      
      // Если есть файл, помечаем его состояние как ошибочное
      if (req.file) {
        const uploadKey = `${disk}:${folderPath}:${req.file.originalname}`;
        activeUploads.set(uploadKey, {
          status: 'error',
          error: err.message,
          progress: 0,
          startedAt: new Date()
        });
      }
      
      // Отправляем ответ только если соединение не было прервано
      if (!uploadState.aborted) {
        return res.status(400).json({ error: err.message });
      }
      return;
    }
    
    if (!req.file) {
      logger.warn(`Файл не был получен в запросе для диска ${disk}`);
      if (!uploadState.aborted) {
        return res.status(400).json({ error: 'Файл не был загружен' });
      }
      return;
    }
    
    // Формируем ответ
    const responseFile = {
      name: req.file.originalname,
      size: req.file.size,
      path: path.join(folderPath, req.file.originalname),
      mimetype: req.file.mimetype
    };
    
    // Обновляем статус загрузки файла
    const uploadKey = `${disk}:${folderPath}:${req.file.originalname}`;
    activeUploads.set(uploadKey, {
      status: 'completing',
      progress: 100,
      startedAt: new Date(),
      completedAt: new Date()
    });
    
    // Устанавливаем заголовки для предотвращения буферизации ответа
    if (!uploadState.aborted) {
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Content-Type', 'application/json');
      
      // Отправляем ответ до проверок файловой системы
      logger.info(`Отправка ответа клиенту для файла ${req.file.originalname} (${req.file.size} байт)`);
      
      const responseData = JSON.stringify({
        success: true, 
        message: 'Файл успешно загружен',
        file: responseFile
      });
      
      res.writeHead(200);
      res.end(responseData);
    }
    
    // Выполняем проверку после отправки ответа
    const uploadedFilePath = path.join(fullPath, req.file.originalname);
    fs.access(uploadedFilePath, fs.constants.F_OK, (accessErr) => {
      if (accessErr) {
        logger.error(`Файл был загружен, но не найден на диске: ${uploadedFilePath}`, accessErr);
        activeUploads.set(uploadKey, {
          status: 'error',
          error: 'Файл не был сохранен на диске',
          progress: 100,
          startedAt: new Date(),
          completedAt: new Date()
        });
      } else {
        logger.info(`Файл успешно загружен и проверен: ${uploadedFilePath} (${req.file.size} байт)`);
        
        // Помечаем файл как успешно загруженный
        activeUploads.set(uploadKey, {
          status: 'completed',
          progress: 100,
          startedAt: new Date(),
          completedAt: new Date(),
          size: req.file.size
        });
        
        // Удаляем файл из трекера через 10 секунд вместо 30 секунд
        setTimeout(() => {
          // Проверяем существует ли еще запись перед удалением
          const upload = activeUploads.get(uploadKey);
          if (upload && upload.status === 'completed') {
            logger.info(`Удаление записи о загрузке из трекера: ${uploadKey}`);
            activeUploads.delete(uploadKey);
          }
        }, 10000);
      }
    });
  });
});

// Модифицируем маршрут удаления для проверки активных загрузок
router.delete('/:disk/files', (req, res) => {
  const { disk } = req.params;
  const { filePath } = req.body;
  
  if (!filePath) {
    return res.status(400).json({ error: 'Не указан путь к файлу' });
  }
  
  // Получаем имя файла из пути
  const folderPath = path.dirname(filePath);
  const fileName = path.basename(filePath);
  
  // Проверяем, не загружается ли файл в данный момент
  const uploadKey = `${disk}:${folderPath === '.' ? '' : folderPath}:${fileName}`;
  const activeUpload = activeUploads.get(uploadKey);
  
  if (activeUpload && activeUpload.status === 'uploading') {
    return res.status(409).json({ 
      error: 'Невозможно удалить файл, так как он в процессе загрузки', 
      status: activeUpload.status,
      progress: activeUpload.progress
    });
  }
  
  // Передаем запрос на удаление в контроллер
  fileController.deleteFile(req, res);
});

// Остальные маршруты
router.post('/:disk/createFolder', fileController.createFolder);
router.get('/:disk/download', fileController.downloadFile);

// Маршрут для очистки статуса загрузки конкретного файла
router.post('/:disk/clear-file-upload', fileController.clearFileUploadStatus);

// Маршрут для очистки всех активных загрузок в указанном пути
router.post('/:disk/clear-folder-uploads', (req, res) => {
  const { disk } = req.params;
  const { path: folderPath } = req.body;
  
  if (!global.activeUploads) {
    global.activeUploads = new Map();
    logger.info('Инициализирован новый объект активных загрузок');
    return res.json({ 
      success: true, 
      message: 'Объект активных загрузок инициализирован' 
    });
  }
  
  let count = 0;
  const pathPrefix = `${disk}:${folderPath || ''}:`;
  
  for (const [key, _] of global.activeUploads.entries()) {
    if (key.startsWith(pathPrefix)) {
      global.activeUploads.delete(key);
      count++;
    }
  }
  
  logger.info(`Очищено ${count} активных загрузок для пути ${disk}:${folderPath || ''}`);
  return res.json({ 
    success: true, 
    message: `Очищено ${count} активных загрузок` 
  });
});

// Маршрут для загрузки чанков файла
router.post('/:disk/upload-chunk', (req, res) => {
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  const chunkIndex = parseInt(req.query.chunk || '0');
  const totalChunks = parseInt(req.query.totalChunks || '1');
  const filename = req.query.filename;
  
  if (!filename) {
    return res.status(400).json({ error: 'Имя файла не указано' });
  }
  
  // Проверка подключения диска
  if (!global.mountedDisks[disk]) {
    logger.error(`Попытка загрузки чанка на несмонтированный диск: ${disk}`);
    return res.status(503).json({ 
      error: 'Диск не смонтирован или недоступен', 
      status: 'offline'
    });
  }
  
  const fullPath = path.join(config.disks[disk], folderPath);
  const tempDir = path.join(fullPath, '.tmp_chunks', filename.replace(/[^a-zA-Z0-9_.-]/g, '_'));
  
  // Создаем директорию для хранения чанков, если она не существует
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    logger.info(`Создана временная директория для чанков: ${tempDir}`);
  } catch (error) {
    logger.error(`Ошибка при создании временной директории: ${tempDir}`, error);
    return res.status(500).json({ error: 'Не удалось создать временную директорию для чанков' });
  }
  
  // Настройка хранилища для multer
  const storage = multer.diskStorage({
    destination: function(req, file, cb) {
      cb(null, tempDir);
    },
    filename: function(req, file, cb) {
      // Каждый чанк сохраняем с уникальным именем
      cb(null, `chunk.${chunkIndex}`);
    }
  });
  
  // Настраиваем multer с большим лимитом для чанков
  const upload = multer({ 
    storage,
    limits: { 
      fileSize: config.performance.chunkSize || 10 * 1024 * 1024 // 10MB по умолчанию
    }
  }).single('chunk');
  
  // Устанавливаем увеличенные таймауты
  req.setTimeout(600000); // 10 минут на загрузку чанка
  res.setTimeout(600000);
  
  // Выполняем загрузку чанка
  upload(req, res, async function(err) {
    if (err) {
      logger.error(`Ошибка при загрузке чанка ${chunkIndex} для файла ${filename}:`, err);
      return res.status(400).json({ 
        error: `Ошибка при загрузке чанка: ${err.message}`,
        chunkIndex: chunkIndex
      });
    }
    
    if (!req.file) {
      logger.error(`Чанк ${chunkIndex} для файла ${filename} не был получен`);
      return res.status(400).json({ 
        error: 'Чанк не был загружен',
        chunkIndex: chunkIndex
      });
    }
    
    logger.info(`Чанк ${chunkIndex}/${totalChunks} для файла ${filename} успешно загружен`);
    
    // Обновляем информацию в глобальном трекере загрузок
    const uploadKey = `${disk}:${folderPath}:${filename}`;
    const uploadInfo = global.activeUploads.get(uploadKey) || {
      status: 'chunked_upload',
      startedAt: new Date(),
      totalChunks: totalChunks,
      receivedChunks: [],
      progress: 0
    };
    
    // Добавляем чанк в список полученных
    uploadInfo.receivedChunks = uploadInfo.receivedChunks || [];
    if (!uploadInfo.receivedChunks.includes(chunkIndex)) {
      uploadInfo.receivedChunks.push(chunkIndex);
    }
    
    // Рассчитываем прогресс
    uploadInfo.progress = Math.round((uploadInfo.receivedChunks.length / totalChunks) * 100);
    
    // Если все чанки получены, объединяем их в финальный файл
    if (uploadInfo.receivedChunks.length === totalChunks) {
      // Устанавливаем статус финализации
      uploadInfo.status = 'finalizing';
      global.activeUploads.set(uploadKey, uploadInfo);
      
      // Отправляем ответ клиенту, не дожидаясь объединения файлов
      res.json({
        success: true,
        message: `Получен последний чанк ${chunkIndex}/${totalChunks} для файла ${filename}. Начинаем объединение.`,
        chunkIndex: chunkIndex,
        progress: uploadInfo.progress
      });
      
      // Запускаем объединение чанков в отдельном процессе
      try {
        const finalFilePath = path.join(fullPath, filename);
        const outputStream = fs.createWriteStream(finalFilePath);
        
        outputStream.on('error', (error) => {
          logger.error(`Ошибка при записи объединенного файла ${filename}:`, error);
          uploadInfo.status = 'error';
          uploadInfo.error = `Ошибка при записи объединенного файла: ${error.message}`;
          global.activeUploads.set(uploadKey, uploadInfo);
        });
        
        outputStream.on('finish', () => {
          logger.info(`Файл ${filename} успешно объединен из ${totalChunks} чанков`);
          
          // Проверяем наличие файла
          fs.access(finalFilePath, fs.constants.F_OK, (accessErr) => {
            if (accessErr) {
              logger.error(`Объединенный файл не был найден: ${finalFilePath}`, accessErr);
              uploadInfo.status = 'error';
              uploadInfo.error = 'Объединенный файл не был найден';
            } else {
              // Получаем размер файла
              fs.stat(finalFilePath, (statErr, stats) => {
                if (statErr) {
                  logger.error(`Ошибка при получении информации о файле: ${finalFilePath}`, statErr);
                } else {
                  uploadInfo.fileSize = stats.size;
                }
                
                // Устанавливаем статус завершения
                uploadInfo.status = 'completed';
                uploadInfo.progress = 100;
                uploadInfo.completedAt = new Date();
                global.activeUploads.set(uploadKey, uploadInfo);
                
                // Очищаем временную директорию с чанками
                try {
                  fs.rm(tempDir, { recursive: true, force: true }, (rmErr) => {
                    if (rmErr) {
                      logger.warn(`Не удалось удалить временную директорию: ${tempDir}`, rmErr);
                    } else {
                      logger.info(`Временная директория удалена: ${tempDir}`);
                    }
                  });
                } catch (rmError) {
                  logger.warn(`Ошибка при удалении временной директории: ${tempDir}`, rmError);
                }
                
                // Удаляем запись о загрузке через 30 секунд
                setTimeout(() => {
                  const currentUpload = global.activeUploads.get(uploadKey);
                  if (currentUpload && currentUpload.status === 'completed') {
                    global.activeUploads.delete(uploadKey);
                    logger.info(`Удалена запись о загрузке из трекера: ${uploadKey}`);
                  }
                }, 30000);
              });
            }
          });
        });
        
        // Читаем и объединяем чанки последовательно
        const combineChunks = async () => {
          for (let i = 0; i < totalChunks; i++) {
            try {
              const chunkPath = path.join(tempDir, `chunk.${i}`);
              await new Promise((resolve, reject) => {
                const chunkStream = fs.createReadStream(chunkPath);
                chunkStream.on('error', (error) => {
                  logger.error(`Ошибка при чтении чанка ${i}: ${chunkPath}`, error);
                  reject(error);
                });
                
                chunkStream.pipe(outputStream, { end: false });
                chunkStream.on('end', resolve);
              });
              
              // Обновляем прогресс финализации
              uploadInfo.progress = Math.round(95 + ((i + 1) / totalChunks) * 5); // От 95% до 100%
              global.activeUploads.set(uploadKey, uploadInfo);
              
              logger.info(`Чанк ${i} добавлен к файлу ${filename}`);
            } catch (error) {
              logger.error(`Ошибка при объединении чанка ${i} для файла ${filename}:`, error);
              throw error;
            }
          }
          
          // Закрываем поток записи после всех чанков
          outputStream.end();
        };
        
        // Запускаем объединение
        combineChunks().catch((error) => {
          logger.error(`Критическая ошибка при объединении чанков для файла ${filename}:`, error);
          uploadInfo.status = 'error';
          uploadInfo.error = `Критическая ошибка при объединении чанков: ${error.message}`;
          global.activeUploads.set(uploadKey, uploadInfo);
          
          // Закрываем поток записи в случае ошибки
          outputStream.end();
        });
      } catch (error) {
        logger.error(`Ошибка при начале объединения чанков для файла ${filename}:`, error);
        uploadInfo.status = 'error';
        uploadInfo.error = `Ошибка при объединении чанков: ${error.message}`;
        global.activeUploads.set(uploadKey, uploadInfo);
      }
    } else {
      // Если это не последний чанк, обновляем статус в трекере
      uploadInfo.status = 'chunked_upload';
      global.activeUploads.set(uploadKey, uploadInfo);
      
      // Отвечаем клиенту
      res.json({
        success: true,
        message: `Чанк ${chunkIndex}/${totalChunks} для файла ${filename} успешно загружен`,
        chunkIndex: chunkIndex,
        progress: uploadInfo.progress
      });
    }
  });
});

module.exports = router;