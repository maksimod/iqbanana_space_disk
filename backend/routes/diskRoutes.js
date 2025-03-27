const express = require('express');
const router = express.Router();
const diskController = require('../controllers/diskController');

// Маршрут для получения списка дисков
router.get('/', diskController.getDisks);

// Маршрут для проверки статуса конкретного диска
router.get('/:disk/status', diskController.checkDiskStatus);

// Маршрут для обновления статуса всех дисков
router.post('/refresh-status', diskController.refreshDisksStatus);

module.exports = router;