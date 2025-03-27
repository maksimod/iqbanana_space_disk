const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');

const execPromise = util.promisify(exec);
const fsPromises = fs.promises;

/**
 * Получение списка дисков с информацией о пространстве
 */
const getDisks = async (req, res, next) => {
  try {
    logger.info('Запрос на получение списка дисков');
    
    const diskPromises = Object.entries(config.disks).map(async ([name, mountPoint]) => {
      try {
        // Используем глобальное состояние смонтированности дисков
        const isMounted = global.mountedDisks[name] === true;
        
        if (!isMounted) {
          logger.warn(`Диск ${name} (${mountPoint}) не смонтирован или недоступен`);
          return {
            name,
            mountPoint,
            error: 'Диск не смонтирован или недоступен',
            total: 0,
            free: 0,
            used: 0,
            status: 'offline'
          };
        }

        // Получаем общий размер и доступное пространство из df
        const { stdout: dfOutput } = await execPromise(`df -k "${mountPoint}" | tail -n 1`);
        const dfParts = dfOutput.trim().split(/\s+/);
        
        if (dfParts.length < 4) {
          logger.error(`Неправильный формат вывода df для ${mountPoint}: ${dfOutput}`);
          return {
            name,
            mountPoint,
            error: 'Не удалось получить информацию о диске',
            total: 0,
            free: 0,
            used: 0,
            status: 'error'
          };
        }

        // Получаем общее пространство и доступное из df
        const totalKB = parseInt(dfParts[1], 10);
        const freeKB = parseInt(dfParts[3], 10);
        
        // Получаем фактический размер всех файлов через du
        // Используем команду с игнорированием ошибок чтения для некоторых файлов
        const { stdout: duOutput } = await execPromise(
          `find "${mountPoint}" -type f -exec du -sk {} \\; 2>/dev/null | awk '{sum+=$1} END {print sum}'`
        );
        
        const actualUsedKB = parseInt(duOutput.trim() || '0', 10);
        
        // Конвертируем в байты
        const total = totalKB * 1024;
        const free = freeKB * 1024;
        // Используем du для определения использованного пространства
        const used = actualUsedKB * 1024;
        
        logger.info(`Диск ${name} - данные из df: total=${totalKB}KB, free=${freeKB}KB`);
        logger.info(`Диск ${name} - фактический размер файлов: ${actualUsedKB}KB`);
        logger.info(`Диск ${name} - итого: total=${formatBytes(total)}, used=${formatBytes(used)}, free=${formatBytes(free)}`);
        
        // Дополнительная проверка целостности
        const testFile = path.join(mountPoint, `.disk_verify_${Date.now()}.tmp`);
        const testContent = `Verification at ${new Date().toISOString()}`;
        
        try {
          // Проверяем запись/чтение
          await fsPromises.writeFile(testFile, testContent);
          const readContent = await fsPromises.readFile(testFile, 'utf8');
          await fsPromises.unlink(testFile);
          
          if (readContent !== testContent) {
            logger.error(`Ошибка целостности диска ${name}: данные не совпадают`);
            return {
              name,
              mountPoint,
              error: 'Ошибка целостности диска',
              total,
              free,
              used,
              status: 'error'
            };
          }
        } catch (ioError) {
          logger.error(`Ошибка доступа к диску ${name} при проверке целостности`, ioError);
          // Если произошла ошибка при проверке, отмечаем диск как недоступный
          global.mountedDisks[name] = false;
          
          return {
            name,
            mountPoint,
            error: 'Ошибка доступа к диску при проверке целостности',
            total,
            free,
            used,
            status: 'error'
          };
        }
        
        return {
          name,
          mountPoint,
          total,
          free: Math.max(0, total - used),
          used,
          status: 'online'
        };
      } catch (error) {
        logger.error(`Ошибка при получении информации о диске ${name} (${mountPoint})`, error);
        
        // Отмечаем диск как недоступный при ошибке
        global.mountedDisks[name] = false;
        
        return {
          name,
          mountPoint,
          error: 'Не удалось получить информацию о диске: ' + error.message,
          total: 0,
          free: 0,
          used: 0,
          status: 'error'
        };
      }
    });
    
    const results = await Promise.all(diskPromises);
    logger.info(`Получена информация о ${results.length} дисках`);
    res.json(results);
  } catch (error) {
    logger.error('Ошибка при получении информации о дисках', error);
    next(error);
  }
};

// Вспомогательная функция для форматирования байтов
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Проверка доступности диска - новый метод для внешнего API
 */
const checkDiskStatus = async (req, res, next) => {
  try {
    const { disk } = req.params;
    
    if (!config.disks[disk]) {
      return res.status(404).json({ error: 'Диск не найден' });
    }
    
    const mountPoint = config.disks[disk];
    const isMounted = global.mountedDisks[disk] === true;
    
    if (!isMounted) {
      return res.json({
        name: disk,
        status: 'offline',
        message: 'Диск не смонтирован или недоступен'
      });
    }
    
    // Дополнительная проверка доступности
    const testFile = path.join(mountPoint, `.disk_check_${Date.now()}.tmp`);
    const testContent = `Check at ${new Date().toISOString()}`;
    
    try {
      await fsPromises.writeFile(testFile, testContent);
      const readContent = await fsPromises.readFile(testFile, 'utf8');
      await fsPromises.unlink(testFile);
      
      if (readContent !== testContent) {
        logger.error(`Проверка диска ${disk}: данные не совпадают`);
        return res.json({
          name: disk,
          status: 'error',
          message: 'Ошибка целостности данных'
        });
      }
      
      return res.json({
        name: disk,
        status: 'online',
        message: 'Диск доступен и работает корректно'
      });
    } catch (error) {
      logger.error(`Ошибка при проверке диска ${disk}`, error);
      
      // Отмечаем диск как недоступный
      global.mountedDisks[disk] = false;
      
      return res.json({
        name: disk,
        status: 'error',
        message: 'Ошибка при проверке доступности диска'
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Принудительное обновление статуса всех дисков
 */
const refreshDisksStatus = async (req, res, next) => {
  try {
    logger.info('Запрос на обновление статуса всех дисков');
    
    const results = {};
    
    for (const [name, mountPoint] of Object.entries(config.disks)) {
      try {
        // Проверка через df
        const dfCheck = await execPromise(`df "${mountPoint}" | grep "${mountPoint}"`)
          .then(() => true)
          .catch(() => false);
        
        // Проверка через findmnt
        const findmntCheck = await execPromise(`findmnt -n "${mountPoint}"`)
          .then(({stdout}) => !!stdout.trim())
          .catch(() => false);
        
        // Проверка записи/чтения
        let ioCheck = false;
        if (dfCheck && findmntCheck) {
          const testFile = path.join(mountPoint, `.refresh_${Date.now()}.tmp`);
          const testContent = `Refresh check at ${new Date().toISOString()}`;
          
          try {
            await fsPromises.writeFile(testFile, testContent);
            const readContent = await fsPromises.readFile(testFile, 'utf8');
            await fsPromises.unlink(testFile);
            ioCheck = (readContent === testContent);
          } catch (e) {
            ioCheck = false;
          }
        }
        
        // Диск считается доступным только если все три проверки пройдены
        const isMounted = dfCheck && findmntCheck && ioCheck;
        
        // Обновляем глобальное состояние
        global.mountedDisks[name] = isMounted;
        
        results[name] = {
          status: isMounted ? 'online' : 'offline',
          checks: { dfCheck, findmntCheck, ioCheck }
        };
      } catch (error) {
        logger.error(`Ошибка при обновлении статуса диска ${name}`, error);
        global.mountedDisks[name] = false;
        results[name] = { status: 'error', error: error.message };
      }
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      disks: results
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDisks,
  checkDiskStatus,
  refreshDisksStatus
};