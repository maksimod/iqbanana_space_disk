const express = require('express');
const authController = require('../controllers/authController');

const router = express.Router();

// Регистрация нового пользователя
router.post('/register', authController.register);

// Вход в систему
router.post('/login', authController.login);

// Проверка статуса аутентификации
router.get('/check', authController.checkAuth);

// Выход из системы
router.post('/logout', authController.logout);

module.exports = router; 