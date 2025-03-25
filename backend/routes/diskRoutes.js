const express = require('express');
const router = express.Router();
const diskController = require('../controllers/diskController');

// Маршрут для получения списка дисков
router.get('/', diskController.getDisks);

module.exports = router;