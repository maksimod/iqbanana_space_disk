const os = require('os');
const { version: serverVersion } = require('../package.json');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Получение информации о системе
 */
const getSystemInfo = (req, res, next) => {
  try {
    logger.info('Запрос системной информации');
    
    const systemInfo = {
      server: {
        version: serverVersion,
        apiVersion: config.apiVersion,
        uptime: Math.floor(process.uptime())
      },
      system: {
        platform: os.platform(),
        release: os.release(),
        hostname: os.hostname(),
        type: os.type(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime()
      },
      disks: Object.keys(config.disks).map(name => ({
        name,
        mountPoint: config.disks[name]
      }))
    };
    
    res.json(systemInfo);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSystemInfo
};