const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

// Маршрут для получения информации о системе
router.get('/info', systemController.getSystemInfo);

module.exports = router;