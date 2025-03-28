const express = require('express');
const router = express.Router();
const diskController = require('../controllers/diskController');
const apiKeyAuth = require('../middleware/apiKeyAuth');

// Apply API key authentication to all routes
router.use(apiKeyAuth);

// Get list of all disks
router.get('/', diskController.getDisks);

// Rename a single disk
router.post('/rename', diskController.renameDisk);

// Bulk rename multiple disks
router.post('/rename-bulk', diskController.renameBulkDisks);

module.exports = router; 