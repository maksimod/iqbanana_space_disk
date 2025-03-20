const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const updateDisksController = require('../controllers/updateDisksController');

// Существующий маршрут для получения информации о системе
router.get('/info', systemController.getSystemInfo);

// Новый маршрут для обновления информации о дисках
router.post('/update-disks', updateDisksController.checkApiKey, updateDisksController.updateDisks);

module.exports = router;