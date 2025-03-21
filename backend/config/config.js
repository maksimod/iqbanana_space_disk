// Конфигурация приложения
const config = {
  // Базовые настройки
  server: {
    port: process.env.PORT || 6005,
    allowedOrigins: [
      'http://46.35.241.37:6001', 
      'http://localhost:6001',
      'https://iqbanana.online',
      'http://iqbanana.online'
    ]
  },
  
  // Версия API
  apiVersion: 'v1',
  
  // Пути к смонтированным дискам на веб-сервере
 disks: {
 'disk_sda1': '/mnt/disk_sda1',
 'disk_sda5': '/mnt/disk_sda5',
 'disk_sdb1': '/mnt/disk_sdb1',
 'disk_sdc1': '/mnt/disk_sdc1'
 }
};

module.exports = config;
