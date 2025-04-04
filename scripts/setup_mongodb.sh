#!/bin/bash

# Скрипт для настройки MongoDB и установки необходимых пакетов
# Использование: ./setup_mongodb.sh

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Проверка прав суперпользователя
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Этот скрипт должен быть запущен с правами суперпользователя (sudo)${NC}"
   exit 1
fi

# Функция для логирования
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

log "Начало настройки MongoDB и необходимых пакетов..."

# Определение версии Debian
DEBIAN_VERSION=$(lsb_release -rs)
log "Версия Debian: $DEBIAN_VERSION"

# Установка MongoDB 6.0 для Debian 12 (bookworm)
log "Установка MongoDB 6.0..."

# Установка необходимых зависимостей
log "Установка необходимых зависимостей..."
apt-get update
apt-get install -y gnupg curl

# Импорт публичного ключа MongoDB 6.0
log "Импорт публичного ключа MongoDB 6.0..."
curl -fsSL https://pgp.mongodb.com/server-6.0.asc | gpg -o /usr/share/keyrings/mongodb-server-6.0.gpg --dearmor

# Создание файла списка источников MongoDB 6.0
log "Создание файла репозитория MongoDB 6.0..."
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/6.0 main" | tee /etc/apt/sources.list.d/mongodb-org-6.0.list

# Обновление списка пакетов
log "Обновление списка пакетов..."
apt-get update

# Установка MongoDB
log "Установка MongoDB 6.0..."
apt-get install -y mongodb-org

# Проверка статуса MongoDB
log "Настройка службы MongoDB..."
systemctl daemon-reload
systemctl enable mongod
systemctl start mongod

# Проверка статуса MongoDB
sleep 5
if systemctl is-active --quiet mongod; then
    log "MongoDB активен и работает"
else
    log "Запуск службы MongoDB..."
    systemctl start mongod
    sleep 5
    if systemctl is-active --quiet mongod; then
        log "MongoDB успешно запущен"
    else
        echo -e "${RED}Не удалось запустить MongoDB. Проверьте журналы: journalctl -u mongod${NC}"
        echo -e "${YELLOW}Пробуем альтернативный метод установки...${NC}"
        
        # Останавливаем MongoDB если запущен
        systemctl stop mongod
        
        # Установка MongoDB через npm (для разработки)
        log "Установка mongodb-memory-server через npm..."
        cd /home/user/iqbanana_space_disk/backend
        npm install mongodb mongoose --save
        npm install mongodb-memory-server --save-dev
        
        # Создаем файл для использования mongodb-memory-server
        cat > /home/user/iqbanana_space_disk/backend/mongodb-memory.js << 'EOF'
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

async function startMongoDB() {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  console.log(`MongoDB Memory Server запущен по адресу ${mongoUri}`);
  return mongoUri;
}

async function stopMongoDB() {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

module.exports = { startMongoDB, stopMongoDB };
EOF
        log "Создан файл mongodb-memory.js для использования MongoDB Memory Server"
        
        # Обновляем владельца
        chown -R user:user /home/user/iqbanana_space_disk/backend
        exit 0
    fi
fi

# Установка mongoose для Node.js
log "Установка mongoose для Node.js..."
cd /home/user/iqbanana_space_disk/backend
npm install mongoose mongodb --save

log "Настройка завершена успешно!"
log "Теперь можно использовать MongoDB для хранения данных приложения"

exit 0 