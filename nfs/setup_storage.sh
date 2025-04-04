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
FORCE_FIX=false
for arg in "$@"; do
    case $arg in
        --skip-raid)
            SKIP_RAID=true
            shift
            ;;
        --force-fix)
            FORCE_FIX=true
            shift
            ;;
    esac
done

echo -e "${GREEN}===== Скрипт настройки NFS и RAID с использованием SSH ключей и UUID =====${NC}"
if [ "$SKIP_RAID" = true ]; then
    echo -e "${YELLOW}Режим без RAID: Настройка RAID-массивов будет пропущена${NC}"
fi
if [ "$FORCE_FIX" = true ]; then
    echo -e "${YELLOW}Режим принудительного исправления: Все экспорты и монтирования будут принудительно перенастроены${NC}"
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

# Очистка fstab от NFS-монтирований
echo -e "${YELLOW}Очистка fstab от NFS монтирований...${NC}"
tmp_fstab=$(mktemp)
grep -v ' nfs ' /etc/fstab > "$tmp_fstab"
cp "$tmp_fstab" /etc/fstab
rm -f "$tmp_fstab"

# Создаем базовый каталог для монтирования
mkdir -p "$MOUNT_BASE"

# 2. Проверка и настройка RAID-массивов
echo -e "${GREEN}2. Настройка RAID-массивов...${NC}"
if [ "${SKIP_RAID:-false}" = "true" ]; then
    echo -e "${YELLOW}Настройка RAID пропускается по параметру SKIP_RAID${NC}"
else
    setup_raid_arrays
fi

# 3. Настройка NFS сервера (перед монтированием)
echo -e "${GREEN}3. Настройка NFS сервера...${NC}"
for port_entry in "${SSH_PORTS[@]}"; do
    server=$(echo $port_entry | cut -d':' -f1)
    port=$(echo $port_entry | cut -d':' -f2)
    
    echo -e "${YELLOW}Проверка и настройка NFS сервера на $server...${NC}"
    remote_exec "$server" "$port" "
        # Проверяем, установлен ли NFS сервер
        if ! dpkg -l | grep -q nfs-kernel-server; then
            echo 'Установка NFS сервера...'
            apt-get update
            DEBIAN_FRONTEND=noninteractive apt-get install -y nfs-kernel-server
        fi
        
        # Проверяем, запущен ли RPC сервис
        if ! systemctl is-active --quiet rpcbind; then
            echo 'Запуск RPC сервиса...'
            systemctl start rpcbind
        fi
        
        # Проверяем, запущен ли NFS сервис
        if ! systemctl is-active --quiet nfs-kernel-server && ! systemctl is-active --quiet nfs-server; then
            echo 'Запуск NFS сервиса...'
            systemctl start nfs-kernel-server || systemctl start nfs-server
        fi
        
        # Проверяем статус сервисов
        echo 'Статус RPC:'
        systemctl status rpcbind --no-pager | head -n 5
        
        echo 'Статус NFS:'
        (systemctl status nfs-kernel-server --no-pager || systemctl status nfs-server --no-pager) | head -n 5
    "
done

# 4. Настройка NFS экспортов
echo -e "${GREEN}4. Настройка NFS экспортов...${NC}"
setup_nfs_exports

# 5. Проверка доступности NFS сервера
echo -e "${GREEN}5. Проверка доступности NFS сервера...${NC}"
for port_entry in "${SSH_PORTS[@]}"; do
    server=$(echo $port_entry | cut -d':' -f1)
    port=$(echo $port_entry | cut -d':' -f2)
    
    echo -e "${YELLOW}Проверка NFS сервера на $server...${NC}"
    
    # Проверяем, что NFS сервер отвечает на RPC запросы
    rpc_check=$(timeout 5 rpcinfo -p "$server" 2>/dev/null | grep -E 'nfs|100003' || echo "")
    if [ -z "$rpc_check" ]; then
        echo -e "${RED}NFS сервер на $server не отвечает на RPC запросы!${NC}"
        echo -e "${YELLOW}Исправление NFS сервера на $server...${NC}"
        remote_exec "$server" "$port" "
            exportfs -rf
            systemctl restart rpcbind
            systemctl restart nfs-kernel-server || systemctl restart nfs-server
            sleep 5
            echo 'Проверка регистрации NFS:'
            rpcinfo -p | grep nfs
        "
    else
        echo -e "${GREEN}✓ NFS сервер на $server отвечает на RPC запросы${NC}"
    fi
    
    # Проверяем, что экспорты настроены
    exports_check=$(showmount -e "$server" 2>/dev/null || echo "")
    if [ -z "$exports_check" ]; then
        echo -e "${RED}NFS сервер на $server не имеет экспортов!${NC}"
        echo -e "${YELLOW}Исправление экспортов на $server...${NC}"
        remote_exec "$server" "$port" "
            exportfs -rf
            exportfs -v
        "
    else
        echo -e "${GREEN}✓ NFS сервер на $server имеет настроенные экспорты:${NC}"
        echo "$exports_check"
    fi
done

# 6. Монтирование NFS шар
echo -e "${GREEN}6. Монтирование NFS шар...${NC}"
mount_nfs_shares

# 7. Обновление конфигурации backend
echo -e "${GREEN}7. Обновление конфигурации backend...${NC}"
if [ -n "$CONFIG_PATH" ]; then
    update_backend_config
else
    echo -e "${YELLOW}Пропускаем обновление конфигурации backend: CONFIG_PATH не задан${NC}"
fi

# 8. Проверка правильности монтирования
echo -e "${GREEN}8. Проверка правильности монтирования...${NC}"
nfs_mounts=$(mount | grep nfs)
if [ -z "$nfs_mounts" ]; then
    echo -e "${RED}Не обнаружено ни одного смонтированного NFS диска!${NC}"
    echo -e "${YELLOW}Возможно, вам нужно вручную проверить состояние сервера:${NC}"
    
    for port_entry in "${SSH_PORTS[@]}"; do
        server=$(echo $port_entry | cut -d':' -f1)
        port=$(echo $port_entry | cut -d':' -f2)
        
        echo -e "${YELLOW}Команды для проверки сервера $server:${NC}"
        echo "ssh ${SSH_USER}@${server} -p ${port} -i ${SSH_KEY_PATH} 'sudo systemctl status nfs-kernel-server'"
        echo "ssh ${SSH_USER}@${server} -p ${port} -i ${SSH_KEY_PATH} 'sudo exportfs -v'"
        echo "ssh ${SSH_USER}@${server} -p ${port} -i ${SSH_KEY_PATH} 'sudo rpcinfo -p | grep nfs'"
    done
else
    echo -e "${GREEN}✓ NFS диски успешно смонтированы:${NC}"
    echo "$nfs_mounts"
    
    echo -e "${YELLOW}Записи в /etc/fstab:${NC}"
    grep nfs /etc/fstab
fi

# Вывод итоговой информации
echo -e "${GREEN}===== Настройка завершена =====${NC}"
echo -e "${YELLOW}Проверка смонтированных дисков:${NC}"
mount | grep -E "$MOUNT_BASE|nfs"
echo -e "${YELLOW}Проверка записей в fstab:${NC}"
grep -E "$MOUNT_BASE|nfs" /etc/fstab

# Проверка доступности записи в смонтированные диски
for mount_path in $(mount | grep nfs | awk '{print $3}'); do
    echo -e "${YELLOW}Проверка возможности записи в $mount_path...${NC}"
    if touch "$mount_path/test_$(date +%s)" 2>/dev/null; then
        echo -e "${GREEN}✓ Запись в $mount_path работает${NC}"
        rm -f "$mount_path/test_$(date +%s)" 2>/dev/null
    else
        echo -e "${RED}✗ Не удалось записать в $mount_path${NC}"
    fi
done

echo -e "${GREEN}Все диски теперь смонтированы по UUID: $MOUNT_BASE/UUID вместо /mnt/storage/имя_диска${NC}"

exit 0