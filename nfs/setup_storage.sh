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
        --force-fix)``
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

# 0b. Исправление неправильных экспортов на серверах (если нужно)
echo -e "${GREEN}0b. Проверка и исправление экспортов NFS на серверах...${NC}"
for port_entry in "${SSH_PORTS[@]}"; do
    server=$(echo $port_entry | cut -d':' -f1)
    port=$(echo $port_entry | cut -d':' -f2)
    
    for disk_config in "${DISKS_TO_MOUNT[@]}"; do
        # Пропускаем RAID-конфигурации
        if is_raid_config "$disk_config"; then
            continue
        fi
        
        # Разбираем информацию о диске - формат server:uuid
        IFS=':' read -r disk_server uuid <<< "$disk_config"
        
        # Пропускаем, если это другой сервер
        if [ "$disk_server" != "$server" ]; then
            continue
        fi
        
        echo -e "${YELLOW}Проверка экспортов для UUID $uuid на сервере $server...${NC}"
        
        # Проверяем текущие экспорты
        exports=$(remote_exec "$server" "$port" "exportfs -v" | grep -v "Выполнение команды" | grep -v "✓ Команда успешно")
        
        # Проверяем, есть ли экспорты по физическому имени диска (sdb) вместо UUID
        physical_exports=$(echo "$exports" | grep "/mnt/storage/sd")
        uuid_exports=$(echo "$exports" | grep "/mnt/storage/$uuid")
        
        if [ -n "$physical_exports" ] || [ -z "$uuid_exports" ] || [ "$FORCE_FIX" = true ]; then
            echo -e "${YELLOW}Обнаружены неправильные экспорты или необходимо принудительное исправление на сервере $server${NC}"
            
            # Создаем скрипт для исправления экспортов на сервере
            echo -e "${YELLOW}Создание скрипта для исправления экспортов...${NC}"
            fix_script=$(mktemp)
            
            cat > "$fix_script" << EOF
#!/bin/bash
set -e

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "\${GREEN}\${BOLD}Исправление экспортов NFS для использования UUID вместо физического имени диска\${NC}"

# UUID диска
UUID="$uuid"
# IP клиента для экспорта
CLIENT_IP="$CLIENT_IP"

# Поиск физического устройства по UUID
echo -e "\${YELLOW}Поиск физического устройства по UUID \${UUID}...\${NC}"
DEVICE=\$(blkid | grep -i "\$UUID" | awk -F: '{print \$1}')
PHYSICAL_DISK=\$(basename "\$DEVICE")

if [ -z "\$DEVICE" ]; then
    echo -e "\${RED}ОШИБКА: Не найдено устройство с UUID \$UUID\${NC}"
    echo -e "Доступные устройства:"
    blkid
    exit 1
fi

echo -e "\${GREEN}Найдено устройство: \$DEVICE (имя диска: \$PHYSICAL_DISK)\${NC}"

# Проверка типа файловой системы
FS_TYPE=\$(blkid -o value -s TYPE "\$DEVICE" 2>/dev/null)
echo -e "\${YELLOW}Тип файловой системы: \$FS_TYPE\${NC}"

# Вывод текущих монтирований
echo -e "\${YELLOW}Текущие монтирования:\${NC}"
mount | grep "/mnt/storage"

# Вывод текущих экспортов
echo -e "\${YELLOW}Текущие экспорты NFS:\${NC}"
cat /etc/exports
exportfs -v

# Создание директории для UUID
echo -e "\${YELLOW}Создание директории для монтирования по UUID...\${NC}"
mkdir -p "/mnt/storage/\$UUID"

# Размонтирование всех существующих монтирований
echo -e "\${YELLOW}Размонтирование всех существующих монтирований...\${NC}"
umount -f -l "\$DEVICE" 2>/dev/null || true
umount -f -l "/mnt/storage/\$PHYSICAL_DISK" 2>/dev/null || true
umount -f -l "/mnt/storage/sdb" 2>/dev/null || true
umount -f -l "/mnt/storage/\$UUID" 2>/dev/null || true

# Монтирование диска в новую директорию
echo -e "\${YELLOW}Монтирование \$DEVICE в /mnt/storage/\$UUID...\${NC}"
mount -t "\$FS_TYPE" -o rw,noatime,nodiratime "\$DEVICE" "/mnt/storage/\$UUID"

# Проверка успешности монтирования
if ! mount | grep -q "/mnt/storage/\$UUID"; then
    echo -e "\${RED}ОШИБКА: Не удалось смонтировать диск\${NC}"
    exit 1
fi

echo -e "\${GREEN}Диск успешно смонтирован в /mnt/storage/\$UUID\${NC}"

# Установка прав доступа
echo -e "\${YELLOW}Установка прав доступа...\${NC}"
chmod -R 777 "/mnt/storage/\$UUID"

# Обновление /etc/fstab
echo -e "\${YELLOW}Обновление /etc/fstab...\${NC}"
FSTAB_TMP=\$(mktemp)
grep -v "/mnt/storage/" /etc/fstab > "\$FSTAB_TMP"
echo "UUID=\$UUID /mnt/storage/\$UUID \$FS_TYPE rw,noatime,nodiratime 0 0" >> "\$FSTAB_TMP"
mv "\$FSTAB_TMP" /etc/fstab

# Обновление NFS экспортов
echo -e "\${YELLOW}Обновление NFS экспортов...\${NC}"
EXPORTS_TMP=\$(mktemp)
grep -v "/mnt/storage/" /etc/exports > "\$EXPORTS_TMP"
echo "/mnt/storage/\$UUID $CLIENT_IP(rw,sync,no_subtree_check,no_root_squash,insecure)" >> "\$EXPORTS_TMP"
mv "\$EXPORTS_TMP" /etc/exports

# Перезапуск NFS
echo -e "\${YELLOW}Перезапуск NFS сервера...\${NC}"
exportfs -ra
systemctl restart nfs-kernel-server || systemctl restart nfs-server

# Проверка статуса NFS
echo -e "\${YELLOW}Статус NFS сервера:\${NC}"
(systemctl status nfs-kernel-server || systemctl status nfs-server) | head -n15
echo -e "\${YELLOW}Новые экспорты:\${NC}"
exportfs -v

echo -e "\${GREEN}\${BOLD}Готово! Сервер настроен для использования UUID вместо имени диска.\${NC}"
EOF
            
            # Делаем скрипт исполняемым
            chmod +x "$fix_script"
            
            # Копируем скрипт на сервер
            remote_script="/tmp/fix_exports_$(date +%s).sh"
            echo -e "${YELLOW}Копирование скрипта на сервер $server...${NC}"
            scp -i "$SSH_KEY_PATH" -P "$port" -o StrictHostKeyChecking=no "$fix_script" "${SSH_USER}@${server}:${remote_script}" > /dev/null 2>&1
            
            # Запускаем скрипт на сервере
            echo -e "${YELLOW}Запуск скрипта на сервере $server...${NC}"
            remote_exec "$server" "$port" "chmod +x ${remote_script} && sudo ${remote_script}"
            
            # Удаляем временные файлы
            rm -f "$fix_script"
            remote_exec "$server" "$port" "rm -f ${remote_script}" > /dev/null 2>&1
            
            echo -e "${GREEN}✓ Экспорты на сервере $server успешно исправлены для UUID $uuid${NC}"
        else
            echo -e "${GREEN}✓ Экспорты на сервере $server уже настроены правильно для UUID $uuid${NC}"
        fi
    done
done

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

# 6. Проверка правильности монтирования
echo -e "${GREEN}6. Проверка правильности монтирования...${NC}"
wrong_mounts=$(mount | grep nfs | grep -v "/mnt/storage/$uuid" | grep "/mnt/storage/sd")

if [ -n "$wrong_mounts" ]; then
    echo -e "${RED}Обнаружены неправильно смонтированные шары (по имени диска вместо UUID):${NC}"
    echo "$wrong_mounts"
    
    echo -e "${YELLOW}Исправление неправильных монтирований...${NC}"
    for mount_line in "$wrong_mounts"; do
        server=$(echo "$mount_line" | awk '{print $1}' | cut -d':' -f1)
        path=$(echo "$mount_line" | awk '{print $1}' | cut -d':' -f2)
        mount_point=$(echo "$mount_line" | awk '{print $3}')
        
        echo -e "${YELLOW}Размонтирование $mount_point...${NC}"
        umount -f -l "$mount_point" 2>/dev/null || true
        
        # Извлечение UUID из mount_point
        uuid_from_path=$(basename "$mount_point")
        
        # Повторное монтирование с правильным путем
        echo -e "${YELLOW}Повторное монтирование с правильным путем...${NC}"
        mount -t nfs -o "$NFS_MOUNT_OPTIONS" "$server:/mnt/storage/$uuid_from_path" "$mount_point"
        
        # Обновление /etc/fstab
        fstab_tmp=$(mktemp)
        grep -v "$mount_point" /etc/fstab > "$fstab_tmp"
        echo "$server:/mnt/storage/$uuid_from_path $mount_point nfs $NFS_MOUNT_OPTIONS 0 0" >> "$fstab_tmp"
        mv "$fstab_tmp" /etc/fstab
        
        echo -e "${GREEN}✓ Монтирование исправлено на $server:/mnt/storage/$uuid_from_path${NC}"
    done
else
    echo -e "${GREEN}✓ Все шары смонтированы правильно, используя UUID вместо имен дисков${NC}"
fi

# Вывод итоговой информации
echo -e "${GREEN}===== Настройка завершена =====${NC}"
echo -e "${YELLOW}Проверка смонтированных дисков:${NC}"
mount | grep -E "$MOUNT_BASE"
echo -e "${YELLOW}Проверка записей в fstab:${NC}"
grep -E "$MOUNT_BASE" /etc/fstab
echo -e "${GREEN}Все диски теперь смонтированы по UUID: $MOUNT_BASE/UUID вместо /mnt/storage/имя_диска${NC}"

exit 0