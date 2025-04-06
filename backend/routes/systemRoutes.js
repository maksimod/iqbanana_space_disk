const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const updateDisksController = require('../controllers/updateDisksController');
const backupController = require('../controllers/backupController');

// Существующий маршрут для получения информации о системе
router.get('/info', systemController.getSystemInfo);

// Новый маршрут для обновления информации о дисках
router.post('/update-disks', updateDisksController.checkApiKey, updateDisksController.updateDisks);

// Маршрут для обновления статуса бэкапа - больше не нужен здесь, обрабатывается напрямую в server.js
// router.post('/backup-status', backupController.checkBackupApiKey, backupController.updateBackupStatus);

module.exports = router;