// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const diskusage = require('diskusage');

const app = express();
const PORT = process.env.PORT || 6005;

// Middleware
app.use(cors({
  origin: '*', // Разрешить запросы с любого источника (только для разработки!)
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Пути к смонтированным дискам на веб-сервере
const disks = {
  'disk_sda1': '/mnt/disk_sda1',
  'disk_sdb1': '/mnt/disk_sdb1',
  'disk_sdb5': '/mnt/disk_sdb5'
};

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const disk = req.params.disk;
    const folderPath = req.query.path || '';
    const fullPath = path.join(disks[disk], folderPath);
    
    if (!fs.existsSync(fullPath)) {
      return cb(new Error('Путь не существует'));
    }
    cb(null, fullPath);
  },
  filename: function(req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

// API для получения списка дисков с информацией о пространстве
app.get('/api/disks', (req, res) => {
  const disksInfo = [];
  
  // Для каждого диска получаем информацию о пространстве
  const promises = Object.entries(disks).map(([name, mountPoint]) => {
    return new Promise((resolve) => {
      try {
        diskusage.check(mountPoint, (err, info) => {
          if (err) {
            console.error(`Ошибка при получении информации о диске ${name}:`, err);
            resolve({
              name,
              mountPoint,
              error: 'Не удалось получить информацию о диске'
            });
          } else {
            resolve({
              name,
              mountPoint,
              total: info.total,
              free: info.free,
              used: info.total - info.free
            });
          }
        });
      } catch (error) {
        console.error(`Ошибка при проверке диска ${name}:`, error);
        resolve({
          name,
          mountPoint,
          error: 'Не удалось получить информацию о диске'
        });
      }
    });
  });
  
  Promise.all(promises)
    .then(results => {
      res.json(results);
    })
    .catch(error => {
      console.error('Ошибка при получении информации о дисках:', error);
      res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    });
});

// API для получения списка файлов в директории
app.get('/api/disks/:disk/files', (req, res) => {
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  
  if (!disks[disk]) {
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(disks[disk], folderPath);
  
  fs.readdir(fullPath, { withFileTypes: true }, (err, files) => {
    if (err) {
      console.error('Ошибка при чтении директории:', err);
      return res.status(500).json({ error: 'Не удалось прочитать директорию' });
    }
    
    const filesList = files.map(file => {
      const isDirectory = file.isDirectory();
      const filePath = path.join(fullPath, file.name);
      let fileSize = 0;
      
      try {
        const stats = fs.statSync(filePath);
        fileSize = stats.size;
      } catch (error) {
        console.error(`Ошибка при получении размера для ${filePath}:`, error);
      }
      
      return {
        name: file.name,
        isDirectory,
        size: fileSize,
        path: path.join(folderPath, file.name)
      };
    });
    
    res.json(filesList);
  });
});

// API для загрузки файла
app.post('/api/disks/:disk/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не был загружен' });
  }
  
  res.json({ 
    success: true, 
    message: 'Файл успешно загружен',
    filename: req.file.filename 
  });
});

// API для удаления файла
app.delete('/api/disks/:disk/files', (req, res) => {
  const { disk } = req.params;
  const { filePath } = req.body;
  
  if (!disks[disk]) {
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(disks[disk], filePath);
  
  fs.stat(fullPath, (err, stats) => {
    if (err) {
      return res.status(404).json({ error: 'Файл не найден' });
    }
    
    if (stats.isDirectory()) {
      fs.rmdir(fullPath, { recursive: true }, (err) => {
        if (err) {
          console.error('Ошибка при удалении директории:', err);
          return res.status(500).json({ error: 'Не удалось удалить директорию' });
        }
        res.json({ success: true, message: 'Директория успешно удалена' });
      });
    } else {
      fs.unlink(fullPath, (err) => {
        if (err) {
          console.error('Ошибка при удалении файла:', err);
          return res.status(500).json({ error: 'Не удалось удалить файл' });
        }
        res.json({ success: true, message: 'Файл успешно удален' });
      });
    }
  });
});

// API для создания папки
app.post('/api/disks/:disk/createFolder', (req, res) => {
  const { disk } = req.params;
  const { folderPath, folderName } = req.body;
  
  if (!disks[disk]) {
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(disks[disk], folderPath, folderName);
  
  // Используем наш специальный скрипт через sudo
  exec(`sudo /usr/local/bin/create-folder.sh "${fullPath}"`, (err, stdout, stderr) => {
    if (err) {
      console.error('Ошибка при создании директории:', err, stderr);
      return res.status(500).json({ error: 'Не удалось создать директорию' });
    }
    
    res.json({ success: true, message: 'Директория успешно создана' });
  });
});

// API для скачивания файла
app.get('/api/disks/:disk/download', (req, res) => {
  const { disk } = req.params;
  const filePath = req.query.path || '';
  
  if (!disks[disk]) {
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(disks[disk], filePath);
  
  fs.stat(fullPath, (err, stats) => {
    if (err) {
      console.error('Ошибка при доступе к файлу:', err);
      return res.status(404).json({ error: 'Файл не найден' });
    }
    
    if (stats.isDirectory()) {
      // Если это директория, создаем zip-архив
      const archiveName = path.basename(filePath) || 'archive';
      const zipFilePath = path.join('/tmp', `${archiveName}-${Date.now()}.zip`);
      
      const output = fs.createWriteStream(zipFilePath);
      const archive = require('archiver')('zip', {
        zlib: { level: 9 } // Максимальный уровень сжатия
      });
      
      output.on('close', () => {
        res.download(zipFilePath, `${archiveName}.zip`, (err) => {
          if (err) {
            console.error('Ошибка при отправке архива:', err);
          }
          
          // Удаляем временный архив после отправки
          fs.unlink(zipFilePath, (err) => {
            if (err) console.error('Ошибка при удалении временного архива:', err);
          });
        });
      });
      
      archive.on('error', (err) => {
        console.error('Ошибка при создании архива:', err);
        res.status(500).json({ error: 'Ошибка при создании архива' });
      });
      
      archive.pipe(output);
      archive.directory(fullPath, false);
      archive.finalize();
    } else {
      // Если это файл, отправляем его напрямую
      res.download(fullPath, path.basename(fullPath), (err) => {
        if (err) {
          console.error('Ошибка при скачивании файла:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Ошибка при скачивании файла' });
          }
        }
      });
    }
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});