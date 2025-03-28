const express = require('express');
const router = express.Router();
const diskRoutes = require('./diskRoutes');
const fileRoutes = require('./fileRoutes');

// Disk management routes
router.use('/disks', diskRoutes);

// File management routes
router.use('/files', fileRoutes);

module.exports = router; 