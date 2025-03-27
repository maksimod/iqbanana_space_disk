// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const config = require('./config/config');
const corsMiddleware = require('./middleware/cors');
const errorHandler = require('./middleware/errorHandler');
const diskRoutes = require('./routes/diskRoutes');
const fileRoutes = require('./routes/fileRoutes');
const systemRoutes = require('./routes/systemRoutes');
const logger = require('./utils/logger');

const execPromise = util.promisify(exec);

// Инициализация Express приложения
const app = express();
const PORT = config.server.port;
const API_VERSION = config.apiVersion;

// Основные middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(logger.requestLogger);

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
        await checkDisksAvailability();
        
        // Запускаем периодическую проверку дисков
        startDiskMonitoring();
        
        // API маршруты с версионированием
        app.use(`/api/${API_VERSION}/disks`, diskRoutes);
        app.use(`/api/${API_VERSION}/disks`, fileRoutes);
        app.use(`/api/${API_VERSION}/system`, systemRoutes);
        
        // Обратная совместимость с предыдущей версией API
        app.use('/api/disks', diskRoutes);
        app.use('/api/disks', fileRoutes);
        app.use('/api/system', systemRoutes);
        
        // Обработка ошибок
        app.use(errorHandler);
        
        // Запуск сервера
        app.listen(PORT, () => {
            logger.info(`Сервер запущен на порту ${PORT}`);
            logger.info(`API доступно по адресу /api/${API_VERSION}`);
            
            const mountedDisksNames = Object.entries(global.mountedDisks)
                .filter(([_, isMounted]) => isMounted)
                .map(([name]) => name);
            
            logger.info(`Доступные диски: ${mountedDisksNames.join(', ')}`);
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