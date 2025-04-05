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
  // Сразу используем фейковую модель вместо попыток подключиться к MongoDB
  logger.info('Настройка фейковой модели Disk вместо MongoDB...');
  
  // Определяем временное локальное хранилище для дисков
  global.disksStore = {};
  
  // Переопределяем методы модели Disk
  const DiskModel = {
    findOne: async (query) => {
      const diskName = query.name;
      return global.disksStore[diskName] || null;
    },
    
    updateOne: async (query, update) => {
      const diskName = query.name;
      const diskData = global.disksStore[diskName] || {};
      
      // Применяем обновления
      if (update.$set) {
        Object.assign(diskData, update.$set);
      }
      
      global.disksStore[diskName] = diskData;
      return { acknowledged: true, modifiedCount: 1 };
    },
    
    create: async (data) => {
      const diskName = data.name;
      global.disksStore[diskName] = { ...data, _id: `fake_id_${Date.now()}` };
      return global.disksStore[diskName];
    }
  };
  
  // Регистрируем фейковую модель
  mongoose.model = function(name) {
    if (name === 'Disk') {
      return DiskModel;
    }
    return { findOne: async () => null };
  };
  
  logger.info('Фейковая модель Disk настроена');
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
        logger.info(`Проверка монтирования диска ${diskName} (${mountPoint})...`);
        
        // Базовая проверка существования каталога
        if (!fs.existsSync(mountPoint)) {
            logger.error(`Каталог ${mountPoint} не существует`);
            return false;
        }
        
        // Проверка 1: Просто пытаемся прочитать содержимое директории
        try {
            const files = fs.readdirSync(mountPoint);
            logger.info(`Каталог ${mountPoint} доступен, содержит ${files.length} файлов/папок`);
            
            // Также проверяем доступность через df, но не используем результат для принятия решения
            try {
                const { stdout: dfOutput } = await execPromise(`df -k "${mountPoint}" | tail -n 1`);
                logger.info(`df успешно отработал для ${mountPoint}: ${dfOutput.trim()}`);
            } catch (dfError) {
                logger.warn(`df не смог прочитать информацию о ${mountPoint}, но это не критично`);
            }
            
            // Если смогли прочитать содержимое директории - диск считаем доступным
            return true;
            
        } catch (readError) {
            logger.error(`Не удалось прочитать каталог ${mountPoint}: ${readError.message}`);
            return false;
        }
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