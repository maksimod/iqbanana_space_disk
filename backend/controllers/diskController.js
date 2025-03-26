const { exec } = require('child_process');
const util = require('util');
const config = require('../config/config');
const logger = require('../utils/logger');

const execPromise = util.promisify(exec);

/**
 * Получение списка дисков с информацией о пространстве
 */
// Найдите функцию getFiles и измените этот фрагмент кода:

const getDisks = async (req, res, next) => {
  try {
    logger.info('Запрос на получение списка дисков');
    
    const diskPromises = Object.entries(config.disks).map(async ([name, mountPoint]) => {
      try {
        // Проверяем, смонтирован ли диск
        const isMounted = await checkIfMounted(mountPoint);
        
        if (!isMounted) {
          logger.warn(`Диск ${name} (${mountPoint}) не смонтирован или недоступен`);
          return {
            name,
            mountPoint,
            error: 'Диск не смонтирован или недоступен',
            total: 0,
            free: 0,
            used: 0
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
            used: 0
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
        
        return {
          name,
          mountPoint,
          total,
          free: Math.max(0, total - used), // Вычисляем свободное место как total - used
          used
        };
      } catch (error) {
        logger.error(`Ошибка при получении информации о диске ${name} (${mountPoint})`, error);
        return {
          name,
          mountPoint,
          error: 'Не удалось получить информацию о диске: ' + error.message,
          total: 0,
          free: 0,
          used: 0
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
 * Проверка монтирования диска
 */
async function checkIfMounted(mountPoint) {
  try {
    const { stdout } = await execPromise(`df "${mountPoint}" | grep "${mountPoint}"`);
    return !!stdout.trim();
  } catch (error) {
    return false;
  }
}

/**
 * Преобразование человекочитаемого размера в байты
 */
function convertToBytes(sizeStr) {
  if (!sizeStr || typeof sizeStr !== 'string') return 0;
  
  // Находим число и единицу измерения (K, M, G, T)
  const match = sizeStr.match(/^([\d.]+)([KMGT])?/i);
  if (!match) return 0;
  
  const [, size, unit] = match;
  const numSize = parseFloat(size); // Используем parseFloat вместо parseInt
  
  switch (unit && unit.toUpperCase()) {
    case 'T': return numSize * 1024 * 1024 * 1024 * 1024;
    case 'G': return numSize * 1024 * 1024 * 1024;
    case 'M': return numSize * 1024 * 1024;
    case 'K': return numSize * 1024;
    default: return numSize;
  }
}

module.exports = {
  getDisks
};