// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const config = require('./config/config');
const corsMiddleware = require('./middleware/cors');
const errorHandler = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/authMiddleware');
const diskRoutes = require('./routes/diskRoutes');
const fileRoutes = require('./routes/fileRoutes');
const systemRoutes = require('./routes/systemRoutes');
const authRoutes = require('./routes/authRoutes');
const logger = require('./utils/logger');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const tempStorage = require('./utils/tempStorage');
const mongoose = require('mongoose');
// Load dotenv for API key environment variables
const dotenv = require('dotenv');
// Добавляем возможность использования MongoDB Memory Server
let mongoMemory;
try {
  mongoMemory = require('./mongodb-memory');
} catch (err) {
  logger.info('MongoDB Memory Server не установлен, используем стандартное подключение');
}

// Load environment variables
dotenv.config();

const execPromise = util.promisify(exec);

// Инициализация Express приложения
const app = express();
const PORT = config.server.port;
const API_VERSION = config.apiVersion;

// Подключение к MongoDB
async function connectToMongoDB() {
  try {
    // Пробуем подключиться к стандартной MongoDB с более коротким таймаутом
    await mongoose.connect('mongodb://127.0.0.1:27017/iqbanana_disk', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 2000, // Более короткий таймаут 2 секунды
      connectTimeoutMS: 2000
    });
    logger.info('Успешное подключение к MongoDB');
  } catch (err) {
    logger.error('Ошибка подключения к стандартной MongoDB:', err.message);
    
    // Если не удалось подключиться к MongoDB, пробуем использовать MongoDB Memory Server
    if (mongoMemory) {
      try {
        logger.info('Пробуем запустить MongoDB Memory Server...');
        const mongoUri = await mongoMemory.startMongoDB();
        await mongoose.connect(mongoUri, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          serverSelectionTimeoutMS: 2000,
          connectTimeoutMS: 2000
        });
        logger.info('Успешное подключение к MongoDB Memory Server');
        
        // Регистрируем обработчик для закрытия MongoDB Memory Server при завершении работы
        process.on('SIGINT', async () => {
          logger.info('Завершение работы, останавливаем MongoDB Memory Server...');
          await mongoMemory.stopMongoDB();
          process.exit(0);
        });
      } catch (memoryError) {
        logger.error('Ошибка при использовании MongoDB Memory Server:', memoryError.message);
        logger.info('Сервер продолжит работу без MongoDB');
      }
    } else {
      logger.info('Сервер продолжит работу без MongoDB');
    }
  }
}

// Запускаем подключение к MongoDB
connectToMongoDB();

// Настройка CORS более детально
const corsOptions = {
  origin: ['http://iqbanana.online:6001', 'http://localhost:6001', 'http://localhost:3000', 'http://127.0.0.1:6001'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-KEY'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Основные middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(logger.requestLogger);

// Инициализация глобального трекера активных загрузок
global.activeUploads = new Map();

// Настройка для загрузки файлов
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    // Временная директория для загрузки файлов
    const tempDir = path.join(__dirname, 'temp');
    
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

// Настройка multer для чанковой загрузки
const upload = multer({ 
  storage,
  limits: { 
    fileSize: config.performance?.chunkSize || 10 * 1024 * 1024 // 10MB по умолчанию для каждого чанка
  }
});

// Делаем multer доступным глобально для маршрутов
global.upload = upload;

// Глобальное состояние для хранения статуса смонтированности дисков
global.mountedDisks = {};

// Функция для проверки реального монтирования диска
// Использует несколько методов для повышения надежности проверки
async function verifyDiskMounting(diskName, mountPoint) {
    try {
        // Проверка 1: Используем df для проверки монтирования
        const { stdout: dfOutput } = await execPromise(`df -T "${mountPoint}" | grep "${mountPoint}"`);
        if (!dfOutput.trim()) {
            return false;
        }
        
        // Проверка 2: Проверяем точку монтирования через findmnt
        const { stdout: findmntOutput } = await execPromise(`findmnt -n "${mountPoint}"`);
        if (!findmntOutput.trim()) {
            return false;
        }
        
        // Проверка 3: Создаем тестовый файл, проверяем сохранение и удаляем
        const testFile = path.join(mountPoint, `.disk_test_${Date.now()}.tmp`);
        const testContent = `Test file created at ${new Date().toISOString()}`;
        
        // Записываем тестовый файл
        fs.writeFileSync(testFile, testContent);
        
        // Проверяем, что файл действительно существует и содержит правильные данные
        const fileContent = fs.readFileSync(testFile, 'utf8');
        if (fileContent !== testContent) {
            logger.error(`Тестовый файл содержит некорректные данные на диске ${diskName}`);
            return false;
        }
        
        // Удаляем тестовый файл
        fs.unlinkSync(testFile);
        
        // Все проверки пройдены - диск действительно смонтирован и работает
        logger.info(`Диск ${diskName} успешно проверен и готов к работе`);
        return true;
    } catch (error) {
        logger.error(`Ошибка при проверке монтирования диска ${diskName} (${mountPoint})`, error);
        return false;
    }
}

// Функция для проверки всех дисков
async function checkDisksAvailability() {
    logger.info('Проверка статуса монтирования дисков...');
    
    for (const [name, mountPoint] of Object.entries(config.disks)) {
        logger.info(`Проверка диска ${name} (${mountPoint})...`);
        
        const isMounted = await verifyDiskMounting(name, mountPoint);
        global.mountedDisks[name] = isMounted;
        
        if (isMounted) {
            logger.info(`Диск ${name} (${mountPoint}) смонтирован и доступен`);
        } else {
            logger.error(`КРИТИЧЕСКАЯ ОШИБКА: Диск ${name} (${mountPoint}) НЕ смонтирован или недоступен`);
        }
    }
    
    // Логирование общего статуса
    const mountedCount = Object.values(global.mountedDisks).filter(Boolean).length;
    const totalCount = Object.keys(global.mountedDisks).length;
    
    logger.info(`Статус дисков: ${mountedCount} из ${totalCount} смонтировано и доступно`);
}

// Функция для периодической проверки дисков
function startDiskMonitoring() {
    // Проверка дисков каждые 5 минут
    setInterval(async () => {
        logger.info('Запуск периодической проверки статуса дисков...');
        await checkDisksAvailability();
    }, 5 * 60 * 1000);
}

// Проверяем доступность всех дисков перед запуском сервера
(async function() {
    try {
        // Инициализация временного хранилища
        await tempStorage.initTempStorage();
        logger.info(`Временное хранилище инициализировано: ${tempStorage.TEMP_DIR}`);
        
        // Инициализация трекера задач синхронизации
        global.syncTasks = new Map();
        
        await checkDisksAvailability();
        
        // Запускаем периодическую проверку дисков
        startDiskMonitoring();
        
        // Маршруты аутентификации (без проверки)
        app.use(`/api/${API_VERSION}/auth`, authRoutes);
        app.use('/api/auth', authRoutes); // Обратная совместимость
        
        // Добавляем маршрут для системной информации
        app.use(`/api/${API_VERSION}/system`, authMiddleware, systemRoutes);
        app.use('/api/system', authMiddleware, systemRoutes); // Обратная совместимость
        
        // API для работы с дисками (защищенные маршруты)
        app.use(`/api/${API_VERSION}/disks`, authMiddleware, diskRoutes);
        app.use(`/api/${API_VERSION}/disks`, authMiddleware, fileRoutes);
        
        // Обратная совместимость с предыдущей версией API
        app.use('/api/disks', authMiddleware, diskRoutes);
        app.use('/api/disks', authMiddleware, fileRoutes);
        
        // Добавляем маршрут для очистки активных загрузок
        app.post('/api/v1/disks/:diskId/clear-uploads', authMiddleware, (req, res) => {
            const { diskId } = req.params;
            
            try {
                if (!global.mountedDisks[diskId]) {
                    logger.error(`Диск ${diskId} не найден при попытке очистить загрузки`);
                    return res.status(404).json({ 
                        success: false, 
                        error: `Диск ${diskId} не найден` 
                    });
                }
                
                // Очищаем активные загрузки для данного диска
                if (global.activeUploads && global.activeUploads instanceof Map) {
                    let count = 0;
                    
                    // Перебираем все загрузки и удаляем те, которые относятся к указанному диску
                    for (const [key, upload] of global.activeUploads.entries()) {
                        if (upload.disk === diskId) {
                            global.activeUploads.delete(key);
                            count++;
                        }
                    }
                    
                    logger.info(`Очищено ${count} активных загрузок для диска ${diskId}`);
                    return res.json({ 
                        success: true, 
                        message: `Очищено ${count} активных загрузок для диска ${diskId}` 
                    });
                } else {
                    // Если глобальный объект не инициализирован, создаем его
                    global.activeUploads = new Map();
                    logger.info(`Создан новый объект активных загрузок для диска ${diskId}`);
                    return res.json({ 
                        success: true, 
                        message: `Активные загрузки для диска ${diskId} не найдены или уже очищены` 
                    });
                }
            } catch (error) {
                logger.error(`Ошибка при очистке активных загрузок для диска ${diskId}:`, error);
                return res.status(500).json({
                    success: false,
                    error: `Ошибка при очистке активных загрузок: ${error.message || 'Неизвестная ошибка'}`
                });
            }
        });

        // Добавляем общий маршрут для очистки всех активных загрузок
        app.post('/api/v1/uploads/clear', authMiddleware, (req, res) => {
            try {
                if (global.activeUploads && global.activeUploads instanceof Map) {
                    const count = global.activeUploads.size;
                    global.activeUploads.clear();
                    logger.info(`Очищены все активные загрузки (${count})`);
                    return res.json({ 
                        success: true, 
                        message: `Очищено ${count} активных загрузок` 
                    });
                } else {
                    // Если глобальный объект не инициализирован, создаем его
                    global.activeUploads = new Map();
                    logger.info('Создан новый объект активных загрузок');
                    return res.json({ 
                        success: true, 
                        message: 'Активные загрузки не найдены или уже очищены' 
                    });
                }
            } catch (error) {
                logger.error('Ошибка при очистке всех активных загрузок:', error);
                return res.status(500).json({
                    success: false,
                    error: `Ошибка при очистке активных загрузок: ${error.message || 'Неизвестная ошибка'}`
                });
            }
        });
        
        // Регистрация маршрутов для удаленного API доступа
        // Это API не требует аутентификации через authMiddleware, вместо этого
        // используется API ключ для доступа из любой точки мира
        const remoteApiRoutes = require('./api/routes/index');
        app.use('/api/remote', remoteApiRoutes);
        logger.info(`Удаленный API зарегистрирован по адресу /api/remote`);
        
        // Обработка ошибок
        app.use(errorHandler);
        
        // Запуск сервера
        app.listen(PORT, '0.0.0.0', () => {
            logger.info(`Сервер запущен на порту ${PORT} (0.0.0.0)`);
            logger.info(`API доступно по адресу /api/${API_VERSION}`);
            
            // Выводим информацию о доступных дисках
            const availableDisks = Object.keys(global.mountedDisks)
                .filter(disk => global.mountedDisks[disk])
                .join(', ');
            
            logger.info(`Доступные диски: ${availableDisks || 'Нет доступных дисков'}`);
        });
        
        // Обработка необработанных ошибок
        process.on('uncaughtException', (error) => {
            logger.error('Необработанное исключение', error);
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Необработанное отклонение промиса', reason);
        });
    } catch (error) {
        logger.error('Критическая ошибка при инициализации сервера', error);
        process.exit(1);
    }
})();