const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const disk = req.params.disk;
    const folderPath = req.query.path || '';
    const fullPath = path.join(config.disks[disk], folderPath);
    
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

module.exports = upload;