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
  
  const diskUploads = Array.from(activeUploads.entries())
    .filter(([key]) => key.startsWith(`${disk}:${folderPath}:`))
    .map(([key, value]) => ({
      filename: key.split(':')[2],
      status: value.status,
      progress: value.progress,
      startedAt: value.startedAt
    }));
  
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

module.exports = router;