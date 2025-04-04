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

# Проверка наличия MongoDB
if command -v mongod &> /dev/null; then
    log "MongoDB уже установлен"
else
    log "Установка MongoDB..."
    
    # Импорт публичного ключа MongoDB
    wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | apt-key add -
    
    # Добавление репозитория MongoDB
    echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-4.4.list
    
    # Обновление списка пакетов
    apt-get update
    
    # Установка MongoDB
    apt-get install -y mongodb-org
    
    # Запуск и включение службы MongoDB
    systemctl start mongod
    systemctl enable mongod
    
    log "MongoDB успешно установлен"
fi

# Проверка статуса MongoDB
if systemctl is-active --quiet mongod; then
    log "MongoDB активен и работает"
else
    log "Запуск службы MongoDB..."
    systemctl start mongod
    if systemctl is-active --quiet mongod; then
        log "MongoDB успешно запущен"
    else
        echo -e "${RED}Не удалось запустить MongoDB. Проверьте журналы: journalctl -u mongod${NC}"
        exit 1
    fi
fi

# Установка mongoose для Node.js
log "Установка mongoose для Node.js..."
cd /home/user/iqbanana_space_disk/backend
npm install mongoose --save

log "Настройка завершена успешно!"
log "Теперь можно использовать MongoDB для хранения данных приложения"

exit 0 