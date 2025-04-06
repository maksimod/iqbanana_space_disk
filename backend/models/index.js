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
    
    // Фейковая модель с расширенным функционалом
    Disk = {
      find: async () => [],
      findOne: async () => null,
      findById: async () => null,
      
      // Добавляем метод create для совместимости с контроллером бэкапа
      create: async (diskData) => {
        console.log('Создание фейкового диска:', diskData);
        return {
          ...diskData,
          save: async () => diskData
        };
      },
      
      // Другие методы, которые могут понадобиться
      updateOne: async () => ({}),
      deleteOne: async () => ({}),
      
      // Метод для обновления/сохранения
      save: async function() {
        console.log('Сохранение фейкового диска:', this);
        return this;
      }
    };
  }
} catch (error) {
  console.error('Ошибка при регистрации модели Disk:', error);
  
  // В случае ошибки тоже используем фейковую модель с расширенным функционалом
  Disk = {
    find: async () => [],
    findOne: async () => null,
    findById: async () => null,
    
    // Добавляем метод create для совместимости
    create: async (diskData) => {
      console.log('Создание фейкового диска (после ошибки):', diskData);
      return {
        ...diskData,
        save: async () => diskData
      };
    },
    
    // Другие методы
    updateOne: async () => ({}),
    deleteOne: async () => ({})
  };
}

module.exports = {
  Disk
}; 