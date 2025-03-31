#!/bin/bash

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Загружаем конфигурацию
source storage_config.sh

# Загружаем переменные окружения
if [ -f ".env" ]; then
    source .env
else
    echo -e "${RED}Ошибка: Файл .env не найден${NC}"
    exit 1
fi

# Загружаем общие функции
source common_functions.sh

# Загружаем функции для RAID
source raid_functions.sh

# Загружаем функции для NFS
source nfs_functions.sh

# Анализ аргументов командной строки
SKIP_RAID=false
for arg in "$@"; do
    case $arg in
        --skip-raid)
            SKIP_RAID=true
            shift
            ;;
    esac
done

echo -e "${GREEN}===== Скрипт настройки NFS и RAID =====${NC}"
if [ "$SKIP_RAID" = true ]; then
    echo -e "${YELLOW}Режим без RAID: Настройка RAID-массивов будет пропущена${NC}"
fi

# Проверка прав root
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Ошибка: Этот скрипт нужно запускать с правами root${NC}"
    echo "Используйте: sudo $0"
    exit 1
fi

# Проверка наличия sshpass
if ! command -v sshpass &> /dev/null; then
    echo "Утилита sshpass не найдена. Установка..."
    apt-get update && apt-get install -y sshpass
fi

# Проверка наличия необходимых переменных окружения
if [ -z "$SSH_HOST_PASSWORD" ]; then
    echo -e "${RED}Ошибка: Не установлена переменная SSH_HOST_PASSWORD в .env${NC}"
    exit 1
fi

# Проверка доступности всех серверов
echo -e "${YELLOW}Проверка доступности серверов...${NC}"
for port_entry in "${SSH_PORTS[@]}"; do
    server=$(echo $port_entry | cut -d':' -f1)
    port=$(echo $port_entry | cut -d':' -f2)
    
    echo -e "${YELLOW}Проверка доступности сервера $server через прокси $SSH_HOST:${port}...${NC}"
    
    # Полагаемся на функцию check_server из common_functions.sh
    check_server "$server" "$port"
done

# 1. Сначала размонтируем существующие NFSы
echo -e "${GREEN}1. Размонтирование существующих NFS...${NC}"
umount -f /mnt/data_storage/* 2>/dev/null || true

# 2. Настраиваем RAID-массивы
if [ "$SKIP_RAID" = false ]; then
    echo -e "${GREEN}2. Настройка RAID-массивов...${NC}"
    setup_raid_arrays
fi

# 3. Настраиваем NFS
echo -e "${GREEN}3. Настройка NFS...${NC}"
setup_nfs_exports

# 4. Монтируем NFS
echo -e "${GREEN}4. Монтирование NFS...${NC}"
mount_nfs_shares

# 5. Обновляем конфигурацию backend
echo -e "${GREEN}5. Обновление конфигурации backend...${NC}"
update_backend_config

echo -e "${GREEN}===== Настройка завершена =====${NC}"