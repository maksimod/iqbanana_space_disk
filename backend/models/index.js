const mongoose = require('mongoose');
const DiskSchema = require('./disk');

// Условная регистрация моделей для предотвращения таймаута MongoDB
let Disk;

try {
  // Проверяем, подключена ли MongoDB
  if (mongoose.connection.readyState === 1) {
    // MongoDB подключена, регистрируем настоящую модель
    Disk = mongoose.model('Disk', DiskSchema);
  } else {
    // MongoDB не подключена, создаем фейковую модель
    console.log('MongoDB не подключена, использование фейковой модели Disk');
    
    // Фейковая модель будет заменена полной версией в server.js
    Disk = {
      find: async () => [],
      findOne: async () => null,
      findById: async () => null
    };
  }
} catch (error) {
  console.error('Ошибка при регистрации модели Disk:', error);
  
  // В случае ошибки тоже используем фейковую модель
  Disk = {
    find: async () => [],
    findOne: async () => null,
    findById: async () => null
  };
}

module.exports = {
  Disk
}; 