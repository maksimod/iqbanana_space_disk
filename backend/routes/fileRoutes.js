const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const upload = require('../middleware/upload');

// Маршрут для получения списка файлов
router.get('/:disk/files', fileController.getFiles);

// Маршрут для загрузки файла
router.post('/:disk/upload', upload.single('file'), fileController.uploadFile);

// Маршрут для удаления файла или директории
router.delete('/:disk/files', fileController.deleteFile);

// Маршрут для создания новой папки
router.post('/:disk/createFolder', fileController.createFolder);

// Маршрут для скачивания файла или папки
router.get('/:disk/download', fileController.downloadFile);

module.exports = router;