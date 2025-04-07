const DiskSchema = require('./disk');

// Создаем базовую модель для работы с дисками
const Disk = {
  find: async () => {
    return Object.entries(require('../config/config').disks).map(([name, path]) => ({
      _id: name,
      name,
      path,
      mountPoint: path,
      status: global.mountedDisks && global.mountedDisks[name] ? 'online' : 'offline',
      total: 0,
      free: 0,
      used: 0,
      userFilesSize: 0
    }));
  },
  findOne: async ({ name }) => {
    const path = require('../config/config').disks[name];
    if (!path) return null;
    return {
      _id: name,
      name,
      path,
      mountPoint: path,
      status: global.mountedDisks && global.mountedDisks[name] ? 'online' : 'offline',
      total: 0,
      free: 0,
      used: 0,
      userFilesSize: 0
    };
  },
  findById: async (id) => {
    if (require('../config/config').disks[id]) {
      const path = require('../config/config').disks[id];
      return {
        _id: id,
        name: id,
        path,
        mountPoint: path,
        status: global.mountedDisks && global.mountedDisks[id] ? 'online' : 'offline',
        total: 0,
        free: 0,
        used: 0,
        userFilesSize: 0
      };
    }
    return null;
  },
  create: async (diskData) => {
    const newDisk = {
      _id: diskData.name,
      ...diskData,
      status: diskData.status || 'online',
      total: diskData.total || 0,
      free: diskData.free || 0,
      used: diskData.used || 0,
      userFilesSize: diskData.userFilesSize || 0
    };
    return newDisk;
  },
  updateOne: async () => ({})
};

module.exports = {
  Disk
}; 