const mongoose = require('mongoose');
const DiskSchema = require('./disk');

// Регистрация моделей
const Disk = mongoose.model('Disk', DiskSchema);

module.exports = {
  Disk
}; 