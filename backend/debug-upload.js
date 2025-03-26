// /backend/debug-upload.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 7777;

// Middleware для отслеживания времени выполнения
app.use((req, res, next) => {
  req.startTime = Date.now();
  
  // Перехватываем окончание ответа
  const oldEnd = res.end;
  res.end = function() {
    const duration = Date.now() - req.startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${duration}ms`);
    return oldEnd.apply(this, arguments);
  };
  next();
});

// Простая загрузка в /tmp для тестирования скорости NFS
app.post('/upload-test', (req, res) => {
  console.log('Начало обработки запроса на загрузку в /tmp...');
  const startTime = Date.now();
  
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, '/tmp');
    },
    filename: (req, file, cb) => {
      cb(null, `test-${Date.now()}-${file.originalname}`);
    }
  });
  
  const upload = multer({ storage }).single('file');
  
  upload(req, res, (err) => {
    const uploadTime = Date.now() - startTime;
    console.log(`Загрузка в /tmp завершена за ${uploadTime}ms`);
    
    if (err) {
      return res.status(400).json({ error: err.message, uploadTime });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен', uploadTime });
    }
    
    res.json({ 
      success: true, 
      message: 'Файл успешно загружен в /tmp',
      file: req.file,
      uploadTime,
      hostname: require('os').hostname()
    });
  });
});

// Тест загрузки на NFS
app.post('/upload-nfs', (req, res) => {
  console.log('Начало обработки запроса на загрузку на NFS...');
  const startTime = Date.now();
  
  const nfsPath = '/mnt/storage/sdb';
  
  // Проверим доступность NFS директории
  fs.access(nfsPath, fs.constants.W_OK, (err) => {
    if (err) {
      console.error(`Ошибка доступа к NFS директории: ${err.message}`);
      return res.status(500).json({ error: 'NFS директория недоступна', details: err.message });
    }
    
    console.log(`NFS директория доступна, время проверки: ${Date.now() - startTime}ms`);
    
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, nfsPath);
      },
      filename: (req, file, cb) => {
        cb(null, `test-${Date.now()}-${file.originalname}`);
      }
    });
    
    const upload = multer({ storage }).single('file');
    
    upload(req, res, (err) => {
      const uploadTime = Date.now() - startTime;
      console.log(`Загрузка на NFS завершена за ${uploadTime}ms`);
      
      if (err) {
        return res.status(400).json({ error: err.message, uploadTime });
      }
      
      if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен', uploadTime });
      }
      
      // Выполним проверку статуса NFS
      exec('mount | grep nfs', (err, stdout) => {
        res.json({ 
          success: true, 
          message: 'Файл успешно загружен на NFS',
          file: req.file,
          uploadTime,
          nfsInfo: stdout || 'Информация о NFS недоступна'
        });
      });
    });
  });
});

// Получение базовой информации о системе
app.get('/system-info', (req, res) => {
  console.log('Запрос информации о системе...');
  
  const commands = [
    'uname -a',                     // Информация о системе
    'df -h /mnt/storage/*',         // Информация о дисках
    'mount | grep nfs',             // Проверка NFS монтирований
    'ps aux | grep node',           // Проверка процессов Node.js
    'netstat -rn',                  // Сетевая маршрутизация
    'cat /etc/hosts'                // Проверка хостов
  ];
  
  const results = {};
  let completed = 0;
  
  commands.forEach(cmd => {
    exec(cmd, (err, stdout, stderr) => {
      results[cmd] = err ? stderr : stdout;
      completed++;
      
      if (completed === commands.length) {
        res.json({
          systemInfo: results,
          timestamp: new Date().toISOString(),
          hostname: require('os').hostname()
        });
      }
    });
  });
});

// Запускаем сервер
app.listen(PORT, () => {
  console.log(`Диагностический сервер запущен на порту ${PORT}`);
  console.log(`Тестовые эндпоинты:`);
  console.log(`- Загрузка в /tmp: http://localhost:${PORT}/upload-test`);
  console.log(`- Загрузка на NFS: http://localhost:${PORT}/upload-nfs`);
  console.log(`- Информация о системе: http://localhost:${PORT}/system-info`);
});