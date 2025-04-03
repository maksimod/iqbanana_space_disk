#!/bin/bash

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Яркое предупреждение о необходимости запуска от root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}${BOLD}ОШИБКА! СКРИПТ ДОЛЖЕН ЗАПУСКАТЬСЯ ОТ ROOT!${NC}"
    echo -e "${RED}${BOLD}Пожалуйста, выполните: su - root${NC}"
    echo -e "${RED}${BOLD}Или запустите команду: sudo $0${NC}"
    exit 1
fi

# Загружаем конфигурацию
source "$(dirname "$0")/storage_config.sh"

# Загружаем переменные окружения
if [ -f "$(dirname "$0")/.env" ]; then
    source "$(dirname "$0")/.env"
    echo -e "${GREEN}✓ Файл .env успешно загружен${NC}"
    echo -e "${YELLOW}Пользователь SSH: $SSH_USER / $SERVER_USER${NC}"
else
    echo -e "${RED}Ошибка: Файл .env не найден в $(dirname "$0")${NC}"
    exit 1
fi

# Загружаем общие функции
source "$(dirname "$0")/common_functions.sh"

# Загружаем функции для RAID
source "$(dirname "$0")/raid_functions.sh"

# Загружаем функции для NFS
source "$(dirname "$0")/nfs_functions.sh"

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

echo -e "${GREEN}===== Скрипт настройки NFS и RAID с использованием SSH ключей и UUID =====${NC}"
if [ "$SKIP_RAID" = true ]; then
    echo -e "${YELLOW}Режим без RAID: Настройка RAID-массивов будет пропущена${NC}"
fi

# Проверка, что скрипт запущен от root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Ошибка: Этот скрипт должен быть запущен от имени root${NC}"
    exit 1
fi

# Проверка наличия SSH ключа
if [ ! -f "$SSH_KEY_PATH" ]; then
    echo -e "${RED}Ошибка: SSH ключ не найден по пути $SSH_KEY_PATH${NC}"
    exit 1
fi

#########################################
# НАЧАЛО ОСНОВНОГО СКРИПТА
#########################################

echo -e "${GREEN}===== Скрипт настройки NFS и RAID с использованием SSH ключей и UUID =====${NC}"

# Распечатываем настройки для проверки
echo -e "${YELLOW}Настройки:${NC}"
echo -e "- База монтирования: $MOUNT_BASE"
echo -e "- IP клиента: $CLIENT_IP"
echo -e "- SSH пользователь: $SSH_USER"
echo -e "- SSH ключ: $SSH_KEY_PATH"
echo -e "- Порты SSH: ${SSH_PORTS[*]}"
echo -e "- Диски для монтирования: ${DISKS_TO_MOUNT[*]}"
echo -e "- Параметры монтирования: $MOUNT_OPTIONS"
echo -e "- NFS опции: $NFS_MOUNT_OPTIONS"
echo -e "- Путь конфигурации: $CONFIG_PATH"

# Проверка доступности серверов через SSH
echo -e "${GREEN}Проверка доступности серверов через SSH ключи...${NC}"
servers_available=true

for port_entry in "${SSH_PORTS[@]}"; do
    server=$(echo $port_entry | cut -d':' -f1)
    port=$(echo $port_entry | cut -d':' -f2)
    
    echo -e "${YELLOW}Проверка доступности сервера $server через SSH ключ...${NC}"
    
    if ! ssh -i "$SSH_KEY_PATH" -p "$port" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_USER@$server" "echo OK" > /dev/null 2>&1; then
        echo -e "${RED}✗ Сервер $server недоступен через SSH${NC}"
        servers_available=false
    else
        echo -e "${GREEN}✓ Сервер $server доступен${NC}"
        
        # Проверка наличия sudo без пароля
        sudo_check=$(ssh -i "$SSH_KEY_PATH" -p "$port" -o StrictHostKeyChecking=no "$SSH_USER@$server" "sudo -n echo OK" 2>&1)
        
        if [[ ! "$sudo_check" == "OK" ]]; then
            echo -e "${RED}✗ Пользователь $SSH_USER на сервере $server не имеет прав sudo без пароля${NC}"
            echo -e "${YELLOW}Пожалуйста, добавьте строку в /etc/sudoers:${NC}"
            echo -e "$SSH_USER ALL=(ALL) NOPASSWD: ALL"
            servers_available=false
        fi
        
        # Проверяем доступность дисков
        echo -e "${YELLOW}Проверка дисков на сервере $server...${NC}"
        disks_output=$(ssh -i "$SSH_KEY_PATH" -p "$port" -o StrictHostKeyChecking=no "$SSH_USER@$server" "sudo ls -la /dev/sd*")
        echo "$disks_output"
    fi
done

if [ "$servers_available" = false ]; then
    echo -e "${RED}Невозможно продолжить: не все серверы доступны или настроены правильно${NC}"
    exit 1
fi

# 1. Размонтирование существующих NFS
echo -e "${GREEN}1. Размонтирование существующих NFS...${NC}"

# Размонтируем все существующие NFS шары
for mount_point in $(mount | grep -E 'nfs|type nfs' | awk '{print $3}'); do
    echo "Размонтирование $mount_point..."
    umount -f -l "$mount_point" 2>/dev/null || true
done

# Также размонтируем старые пути монтирования по имени диска
if [ -d "/mnt/storage" ]; then
    for mount_point in $(mount | grep "/mnt/storage/" | awk '{print $3}'); do
        echo "Размонтирование старого пути $mount_point..."
        umount -f -l "$mount_point" 2>/dev/null || true
    done
fi

# Создаем базовый каталог для монтирования
mkdir -p "$MOUNT_BASE"

# 2. Проверка и настройка RAID-массивов
echo -e "${GREEN}2. Настройка RAID-массивов...${NC}"
if [ "${SKIP_RAID:-false}" = "true" ]; then
    echo -e "${YELLOW}Настройка RAID пропускается по параметру SKIP_RAID${NC}"
else
    setup_raid_arrays
fi

# 3. Настройка NFS экспортов на серверах
echo -e "${GREEN}3. Настройка NFS...${NC}"
setup_nfs_exports

# 4. Монтирование NFS шар на локальном компьютере
echo -e "${GREEN}4. Монтирование NFS...${NC}"
mount_nfs_shares

# 5. Обновление конфигурации backend
echo -e "${GREEN}5. Обновление конфигурации backend...${NC}"
if [ -n "$CONFIG_PATH" ]; then
    update_backend_config
else
    echo -e "${YELLOW}Пропускаем обновление конфигурации backend: CONFIG_PATH не задан${NC}"
fi

# Вывод итоговой информации
echo -e "${GREEN}===== Настройка завершена =====${NC}"
echo -e "${YELLOW}Проверка смонтированных дисков:${NC}"
mount | grep -E "$MOUNT_BASE"
echo -e "${YELLOW}Проверка записей в fstab:${NC}"
grep -E "$MOUNT_BASE" /etc/fstab
echo -e "${GREEN}Все диски теперь смонтированы по UUID: $MOUNT_BASE/UUID вместо /mnt/storage/имя_диска${NC}"

exit 0