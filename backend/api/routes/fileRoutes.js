const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fileController = require('../controllers/fileController');
const apiKeyAuth = require('../middleware/apiKeyAuth');

// Apply API key authentication to all routes
router.use(apiKeyAuth);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: function(req, file, cb) {
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniquePrefix + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// File routes
// Upload a file to a specific disk with directory creation
router.post('/:diskId/upload', upload.single('file'), fileController.uploadFile);

// Download a file from a specific disk
router.get('/:diskId/download', fileController.downloadFile);

// Search for files/folders by name or regex
router.get('/:diskId/search', fileController.searchFiles);

// Delete files by pattern or specific path
router.delete('/:diskId/delete', fileController.deleteFiles);

module.exports = router; 