const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config/config');
const logger = require('../utils/logger');

// Настройка multer для обработки чанков
const chunkStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    // Временная директория для загрузки файлов
    const tempDir = path.join(__dirname, '..', 'temp');
    
    // Создаем временную директорию, если она не существует
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    cb(null, tempDir);
  },
  filename: function(req, file, cb) {
    // Генерируем уникальное имя для временного файла
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, uniqueName);
  }
});

// Создаем экземпляр multer для чанковой загрузки
const chunkUpload = multer({ 
  storage: chunkStorage,
  limits: { 
    fileSize: config.performance?.chunkSize || 10 * 1024 * 1024 // 10MB по умолчанию для каждого чанка
  }
});

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

// Функция для безопасного перемещения файла между разными файловыми системами
const moveFile = async (source, destination) => {
  const readStream = fs.createReadStream(source);
  const writeStream = fs.createWriteStream(destination);
  
  return new Promise((resolve, reject) => {
    readStream.on('error', err => {
      reject(err);
    });
    
    writeStream.on('error', err => {
      reject(err);
    });
    
    writeStream.on('finish', () => {
      // После успешного копирования удаляем исходный файл
      fs.unlink(source, unlinkErr => {
        if (unlinkErr) {
          logger.warn(`Не удалось удалить исходный файл после копирования: ${source}`, unlinkErr);
        }
        resolve();
      });
    });
    
    readStream.pipe(writeStream);
  });
};

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

// Маршрут для загрузки файлов по частям (чанкам)
router.post('/:disk/upload-chunk', chunkUpload.single('chunk'), async (req, res) => {
  try {
    const { disk } = req.params;
    const { 
      index, 
      totalChunks, 
      filename, 
      path: folderPath, 
      uploadId,
      fileSize
    } = req.body;
    
    // Проверки входных данных
    if (!filename) {
      return res.status(400).json({ error: 'Имя файла не указано' });
    }
    
    if (index === undefined || totalChunks === undefined) {
      return res.status(400).json({ error: 'Индекс чанка или общее количество чанков не указаны' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Чанк файла не передан' });
    }
    
    // Проверка подключения диска
    if (!global.mountedDisks[disk]) {
      logger.error(`Попытка загрузки на несмонтированный диск: ${disk}`);
      return res.status(503).json({ 
        error: 'Диск не смонтирован или недоступен', 
        status: 'offline'
      });
    }
    
    // Создаем полный путь к директории
    const fullPath = path.join(config.disks[disk], folderPath || '');
    
    // Создаём директорию для хранения чанков, если она не существует
    const tempDir = path.join(fullPath, '.tmp_chunks', filename.replace(/[^a-zA-Z0-9_.-]/g, '_'));
    
    try {
      await fs.promises.mkdir(tempDir, { recursive: true });
    } catch (mkdirError) {
      logger.error(`Не удалось создать временную директорию для чанков: ${tempDir}`, mkdirError);
      return res.status(500).json({ error: 'Не удалось создать временную директорию для чанков' });
    }
    
    // Путь для сохранения чанка
    const chunkPath = path.join(tempDir, `chunk.${index}`);
    
    try {
      // На безопасное копирование:
      await moveFile(req.file.path, chunkPath);
      
      // Обновляем или создаем запись о загрузке в глобальном трекере
      const uploadKey = `${disk}:${folderPath || ''}:${filename}`;
      let uploadInfo = global.activeUploads.get(uploadKey);
      
      if (!uploadInfo) {
        // Создаем новую запись о загрузке
        uploadInfo = {
          id: uploadId || Date.now().toString(),
          filename,
          disk,
          path: folderPath || '',
          startedAt: new Date(),
          status: 'chunked_upload',
          totalChunks: parseInt(totalChunks, 10),
          uploadedChunks: new Set(),
          fileSize: parseInt(fileSize, 10) || 0,
          progress: 0
        };
      }
      
      // Добавляем чанк в список загруженных
      uploadInfo.uploadedChunks.add(parseInt(index, 10));
      
      // Обновляем прогресс
      const uploadedChunksCount = uploadInfo.uploadedChunks.size;
      uploadInfo.progress = Math.round((uploadedChunksCount / parseInt(totalChunks, 10)) * 95); // Только до 95%, оставляем 5% на финализацию
      
      // Обновляем дату последней активности
      uploadInfo.lastActivity = new Date();
      
      // Сохраняем информацию о загрузке
      global.activeUploads.set(uploadKey, uploadInfo);
      
      logger.info(`Чанк ${index}/${totalChunks} для файла ${filename} успешно загружен на диск ${disk}`);
      
      // Если это последний чанк, возвращаем специальный флаг
      const isLastChunk = parseInt(index, 10) === parseInt(totalChunks, 10) - 1;
      
      return res.json({
        success: true,
        message: `Чанк ${index}/${totalChunks} успешно загружен`,
        isLastChunk,
        uploadInfo: {
          id: uploadInfo.id,
          filename,
          disk,
          path: folderPath || '',
          progress: uploadInfo.progress,
          uploadedChunks: uploadedChunksCount,
          totalChunks: parseInt(totalChunks, 10),
          status: uploadInfo.status
        }
      });
    } catch (error) {
      logger.error(`Ошибка при перемещении чанка ${index} для файла ${filename}:`, error);
      return res.status(500).json({
        error: `Ошибка при сохранении чанка: ${error.message}`
      });
    }
  } catch (error) {
    logger.error('Критическая ошибка при загрузке чанка:', error);
    return res.status(500).json({
      error: `Критическая ошибка при загрузке чанка: ${error.message}`
    });
  }
});

// Маршрут для финализации загрузки по чанкам
router.post('/:disk/finalize-upload', (req, res) => {
  const { disk } = req.params;
  const { filename, path: folderPath, totalChunks, uploadId } = req.body;
  
  if (!filename) {
    return res.status(400).json({ error: 'Имя файла не указано' });
  }
  
  // Проверка подключения диска
  if (!global.mountedDisks[disk]) {
    logger.error(`Попытка финализации загрузки на несмонтированный диск: ${disk}`);
    return res.status(503).json({ 
      error: 'Диск не смонтирован или недоступен', 
      status: 'offline'
    });
  }
  
  const fullPath = path.join(config.disks[disk], folderPath || '');
  const tempDir = path.join(fullPath, '.tmp_chunks', filename.replace(/[^a-zA-Z0-9_.-]/g, '_'));
  const finalFilePath = path.join(fullPath, filename);
  
  // Проверяем, был ли файл уже создан
  fs.access(finalFilePath, fs.constants.F_OK, (accessErr) => {
    if (!accessErr) {
      logger.info(`Файл ${filename} уже существует, финализация не требуется`);
      
      // Обновляем статус в глобальном трекере загрузок
      const uploadKey = `${disk}:${folderPath || ''}:${filename}`;
      const uploadInfo = global.activeUploads.get(uploadKey) || {
        status: 'completing',
        startedAt: new Date(),
        progress: 95
      };
      
      uploadInfo.status = 'completed';
      uploadInfo.progress = 100;
      uploadInfo.completedAt = new Date();
      global.activeUploads.set(uploadKey, uploadInfo);
      
      // Пытаемся очистить временную директорию
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
      
      return res.json({ 
        success: true, 
        message: 'Финализация не требуется, файл уже существует',
        file: {
          name: filename,
          path: folderPath ? `${folderPath}/${filename}` : filename
        }
      });
    }
    
    // Проверяем, существует ли временная директория
    fs.access(tempDir, fs.constants.F_OK, async (tempDirErr) => {
      if (tempDirErr) {
        logger.error(`Временная директория не найдена: ${tempDir}`, tempDirErr);
        return res.status(404).json({ 
          error: 'Временная директория с чанками не найдена',
          message: 'Возможно, загрузка была прервана или чанки были автоматически очищены'
        });
      }
      
      // Устанавливаем статус финализации в глобальном трекере
      const uploadKey = `${disk}:${folderPath || ''}:${filename}`;
      const uploadInfo = global.activeUploads.get(uploadKey) || {
        status: 'finalizing',
        startedAt: new Date(),
        totalChunks: totalChunks,
        progress: 95
      };
      
      uploadInfo.status = 'finalizing';
      uploadInfo.progress = 95;
      global.activeUploads.set(uploadKey, uploadInfo);
      
      // Отправляем ответ клиенту, что начали финализацию
      res.json({
        success: true,
        message: 'Начинаем финализацию загрузки, объединение чанков',
        status: 'finalizing'
      });
      
      // Запускаем процесс объединения чанков в отдельном потоке
      try {
        const outputStream = fs.createWriteStream(finalFilePath);
        
        outputStream.on('error', (error) => {
          logger.error(`Ошибка при записи объединенного файла ${filename}:`, error);
          uploadInfo.status = 'error';
          uploadInfo.error = `Ошибка при записи объединенного файла: ${error.message}`;
          global.activeUploads.set(uploadKey, uploadInfo);
        });
        
        outputStream.on('finish', () => {
          logger.info(`Файл ${filename} успешно объединен из ${totalChunks} чанков`);
          
          // Проверяем успешность создания файла
          fs.access(finalFilePath, fs.constants.F_OK, (finalFileErr) => {
            if (finalFileErr) {
              logger.error(`Объединенный файл не был найден: ${finalFilePath}`, finalFileErr);
              uploadInfo.status = 'error';
              uploadInfo.error = 'Объединенный файл не был найден';
              global.activeUploads.set(uploadKey, uploadInfo);
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
                
                // Удаляем запись о загрузке через 30 минут
                setTimeout(() => {
                  const currentUpload = global.activeUploads.get(uploadKey);
                  if (currentUpload && currentUpload.status === 'completed') {
                    global.activeUploads.delete(uploadKey);
                    logger.info(`Удалена запись о загрузке из трекера: ${uploadKey}`);
                  }
                }, 30 * 60 * 1000); // 30 минут
              });
            }
          });
        });
        
        // Читаем и объединяем чанки последовательно
        const combineChunks = async () => {
          for (let i = 0; i < totalChunks; i++) {
            try {
              const chunkPath = path.join(tempDir, `chunk.${i}`);
              
              // Проверяем наличие чанка
              if (!fs.existsSync(chunkPath)) {
                logger.error(`Чанк ${i} не найден по пути: ${chunkPath}`);
                throw new Error(`Чанк ${i} не найден`);
              }
              
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
        const uploadInfo = global.activeUploads.get(uploadKey) || { status: 'error' };
        uploadInfo.status = 'error';
        uploadInfo.error = `Ошибка при объединении чанков: ${error.message}`;
        global.activeUploads.set(uploadKey, uploadInfo);
      }
    });
  });
});

// Маршрут для отмены загрузки
router.post('/:disk/cancel-upload', (req, res) => {
  const { disk } = req.params;
  const { filename, path: folderPath, uploadId } = req.body;
  
  if (!filename && !uploadId) {
    return res.status(400).json({ error: 'Имя файла или ID загрузки не указаны' });
  }
  
  try {
    // Проверка подключения диска
    if (!global.mountedDisks[disk]) {
      logger.warn(`Попытка отмены загрузки на несмонтированный диск: ${disk}`);
      // Не возвращаем ошибку, просто логируем
    }
    
    // Находим ключ загрузки
    const uploadKey = filename ? 
      `${disk}:${folderPath || ''}:${filename}` : 
      Object.keys(global.activeUploads).find(key => key.includes(uploadId));
    
    if (uploadKey && global.activeUploads.has(uploadKey)) {
      // Получаем информацию о загрузке
      const uploadInfo = global.activeUploads.get(uploadKey);
      
      // Проверяем статус загрузки
      if (uploadInfo.status === 'completed' || uploadInfo.status === 'error') {
        logger.info(`Загрузка ${uploadKey} уже завершена или имеет ошибку`);
        global.activeUploads.delete(uploadKey);
        return res.json({ 
          success: true,
          message: `Загрузка ${uploadKey} уже завершена или имеет ошибку, запись удалена` 
        });
      }
      
      // Обновляем статус загрузки
      uploadInfo.status = 'cancelled';
      uploadInfo.cancelledAt = new Date();
      global.activeUploads.set(uploadKey, uploadInfo);
      
      // Очищаем временные файлы, если это загрузка по частям
      if (uploadInfo.status === 'chunked_upload' || uploadInfo.status === 'finalizing') {
        const fullPath = path.join(config.disks[disk], folderPath || '');
        const tempDir = path.join(fullPath, '.tmp_chunks', filename.replace(/[^a-zA-Z0-9_.-]/g, '_'));
        
        // Проверяем, существует ли временная директория
        fs.access(tempDir, fs.constants.F_OK, (err) => {
          if (!err) {
            // Удаляем временную директорию
            fs.rm(tempDir, { recursive: true, force: true }, (rmErr) => {
              if (rmErr) {
                logger.warn(`Не удалось удалить временную директорию при отмене загрузки: ${tempDir}`, rmErr);
              } else {
                logger.info(`Временная директория удалена при отмене загрузки: ${tempDir}`);
              }
            });
          }
        });
      }
      
      // Удаляем запись о загрузке через 5 минут
      setTimeout(() => {
        if (global.activeUploads.has(uploadKey)) {
          global.activeUploads.delete(uploadKey);
          logger.info(`Удалена запись об отмененной загрузке: ${uploadKey}`);
        }
      }, 5 * 60 * 1000); // 5 минут
      
      logger.info(`Загрузка ${uploadKey} отменена`);
      return res.json({ 
        success: true,
        message: `Загрузка ${uploadKey} отменена` 
      });
    } else {
      logger.warn(`Загрузка ${uploadKey || 'неизвестная'} не найдена для отмены`);
      return res.json({ 
        success: false,
        message: 'Загрузка не найдена' 
      });
    }
  } catch (error) {
    logger.error(`Ошибка при отмене загрузки:`, error);
    return res.status(500).json({
      success: false,
      error: `Ошибка при отмене загрузки: ${error.message}`
    });
  }
});

module.exports = router;