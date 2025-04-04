const mongoose = require('mongoose');

const DiskSchema = new mongoose.Schema({
  // Основная информация о диске
  name: {
    type: String,
    required: true,
    unique: true
  },
  mountPoint: {
    type: String,
    required: true
  },
  total: {
    type: Number,
    default: 0
  },
  used: {
    type: Number,
    default: 0
  },
  free: {
    type: Number,
    default: 0
  },
  userFilesSize: {
    type: Number,
    default: 0
  },
  
  // Информация о статусе
  status: {
    type: String,
    enum: ['online', 'offline', 'error'],
    default: 'offline'
  },
  error: {
    type: String,
    default: null
  },
  
  // Информация о бэкапе
  backupStatus: {
    type: String,
    enum: ['PROCESSING', 'SUCCESS', 'ERROR', null],
    default: null
  },
  backupMessage: {
    type: String,
    default: ''
  },
  backupUpdatedAt: {
    type: Date,
    default: null
  },
  
  // Временные метки
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // Автоматически обновляет createdAt и updatedAt
});

module.exports = DiskSchema; 