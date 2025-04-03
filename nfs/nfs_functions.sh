#!/bin/bash

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Функция для настройки RAID-массивов
setup_raid_arrays() {
    echo -e "${GREEN}Настройка RAID-массивов...${NC}"
    
    # Массив для хранения информации о настроенных RAID-массивах
    declare -a CONFIGURED_RAIDS
    
    # Обработка каждой строки конфигурации дисков
    for disk_config in "${DISKS_TO_MOUNT[@]}"; do
        echo -e "${YELLOW}Обработка конфигурации: $disk_config${NC}"
        
        # Проверяем, является ли это RAID-конфигурацией
        if is_raid_config "$disk_config"; then
            # Это RAID-конфигурация, разбираем ее
            raid_info=($(parse_raid_config "$disk_config"))
            raid_type="${raid_info[0]}"
            disk1="${raid_info[1]}"
            disk2="${raid_info[2]}"
            raid_name="raid_${#CONFIGURED_RAIDS[@]}"
            
            echo "Обнаружена RAID-конфигурация типа: $raid_type"
            echo "Диск 1: $disk1"
            echo "Диск 2: $disk2"
            
            if [ "$raid_type" == "mirror" ]; then
                # Настраиваем RAID-1 (зеркалирование)
                raid_mount=$(setup_raid1_mirror "$disk1" "$disk2" "$raid_name")
                if [ $? -eq 0 ]; then
                    CONFIGURED_RAIDS+=("$raid_mount")
                    echo -e "${GREEN}✓ RAID-1 успешно настроен: $raid_mount${NC}"
                else
                    echo -e "${RED}✗ Не удалось настроить RAID-1${NC}"
                fi
            elif [ "$raid_type" == "stripe" ]; then
                # Настраиваем RAID-0 (чередование)
                raid_mount=$(setup_raid0_stripe "$disk1" "$disk2" "$raid_name")
                if [ $? -eq 0 ]; then
                    CONFIGURED_RAIDS+=("$raid_mount")
                    echo -e "${GREEN}✓ RAID-0 успешно настроен: $raid_mount${NC}"
                else
                    echo -e "${RED}✗ Не удалось настроить RAID-0${NC}"
                fi
            fi
        else
            echo -e "${GREEN}Это обычный диск, не RAID.${NC}"
        fi
    done
    
    # Экспорт переменной для использования в других функциях
    export CONFIGURED_RAIDS
}

# Функция для настройки NFS экспортов
setup_nfs_exports() {
    echo -e "${GREEN}Настройка NFS экспортов...${NC}"
    
    # Принудительное размонтирование всех дисков на всех серверах
    echo -e "${YELLOW}Принудительное размонтирование всех дисков...${NC}"
    for port_entry in "${SSH_PORTS[@]}"; do
        server=$(echo $port_entry | cut -d':' -f1)
        port=$(echo $port_entry | cut -d':' -f2)
        
        echo -e "${YELLOW}Размонтирование дисков на сервере $server...${NC}"
        remote_exec "$server" "$port" "
            # Размонтируем все несистемные диски
            for mount_point in \$(mount | grep '/mnt/storage/' | awk '{print \$3}'); do
                echo \"Размонтирование \$mount_point\"
                umount -f -l \$mount_point 2>/dev/null || true
            done
            
            # Размонтируем все NFS шары
            for mount_point in \$(mount | grep 'nfs' | awk '{print \$3}'); do
                echo \"Размонтирование NFS \$mount_point\"
                umount -f -l \$mount_point 2>/dev/null || true
            done
            
            # Очищаем все старые экспорты
            rm -f /etc/exports.d/*.exports
            echo \"\" > /etc/exports
            exportfs -ra
        "
    done
    
    for disk_config in "${DISKS_TO_MOUNT[@]}"; do
        echo -e "${YELLOW}Обработка конфигурации: $disk_config${NC}"
        
        # Проверяем, является ли это RAID-конфигурацией
        if is_raid_config "$disk_config"; then
            echo -e "${YELLOW}Пропускаем RAID-конфигурацию: $disk_config${NC}"
            continue
        fi
        
        # Обработка обычного диска - в формате server:uuid
        IFS=':' read -r server uuid <<< "$disk_config"
        
        echo -e "${GREEN}===== Настройка сервера $server для диска с UUID $uuid =====${NC}"
        
        # Получаем порт для сервера
        port=$(get_server_port "$server")
        if [ -z "$port" ]; then
            echo -e "${RED}Ошибка: Не найден порт для сервера $server${NC}"
            continue
        fi
        
        # Определяем имя физического устройства по UUID
        echo -e "${YELLOW}Определение физического устройства по UUID на сервере $server...${NC}"
        
        # Создаем временный файл для команды и результата
        local tmp_cmd_file=$(mktemp)
        local tmp_result_file=$(mktemp)
        
        # Записываем команду во временный файл
        echo "blkid | grep -i $uuid | awk -F: '{print \$1}' | xargs basename" > "$tmp_cmd_file"
        
        # Выполняем команду на сервере и сохраняем результат в файл
        remote_exec "$server" "$port" "$(cat $tmp_cmd_file)" > "$tmp_result_file"
        
        # Извлекаем только строку имени диска из результата
        physical_disk=$(cat "$tmp_result_file" | grep -v "Выполнение команды" | grep -v "✓ Команда успешно" | tail -1 | tr -d '\n')
        
        # Удаляем временные файлы
        rm -f "$tmp_cmd_file" "$tmp_result_file"
        
        # Проверяем, содержит ли результат 'sd' (признак имени диска)
        if [[ ! "$physical_disk" =~ sd ]]; then
            echo -e "${YELLOW}Результат не содержит корректное имя диска, запрашиваем явно список устройств...${NC}"
            
            # Запросим напрямую все устройства и попробуем найти нужное
            tmp_result_file=$(mktemp)
            remote_exec "$server" "$port" "for d in /dev/sd*; do echo \"\$d \$(blkid -s UUID -o value \$d 2>/dev/null)\"; done" > "$tmp_result_file"
            
            # Извлекаем диск по UUID
            physical_disk=$(cat "$tmp_result_file" | grep -i "$uuid" | awk '{print $1}' | xargs basename)
            rm -f "$tmp_result_file"
        fi
        
        # Проверяем полученный результат
        if [[ -z "$physical_disk" || ! "$physical_disk" =~ sd ]]; then
            echo -e "${RED}ОШИБКА: Не удалось найти устройство с UUID $uuid на сервере $server${NC}"
            echo -e "${YELLOW}Список доступных дисков:${NC}"
            remote_exec "$server" "$port" "blkid -s UUID"
            continue
        else
            echo -e "${GREEN}✓ Найдено устройство $physical_disk с UUID $uuid на сервере $server${NC}"
        fi
        
        # Сначала проверяем и устанавливаем NFS сервер если нужно
        echo -e "${YELLOW}Проверка наличия NFS сервера на $server...${NC}"
        nfs_installed=$(remote_exec "$server" "$port" "command -v exportfs &>/dev/null && echo 'installed' || echo 'not_installed'" | grep installed)
        
        if [[ -z "$nfs_installed" ]]; then
            echo -e "${YELLOW}Установка NFS сервера на $server...${NC}"
            remote_exec "$server" "$port" "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y nfs-kernel-server"
            
            # Проверяем, что NFS сервер установлен
            nfs_check=$(remote_exec "$server" "$port" "systemctl is-active nfs-kernel-server || systemctl is-active nfs-server || echo 'not_running'" | grep -v "not_running")
            if [[ -z "$nfs_check" ]]; then
                echo -e "${RED}Ошибка: NFS сервер не запущен на $server после установки${NC}"
                echo -e "${YELLOW}Пытаемся запустить сервис вручную...${NC}"
                remote_exec "$server" "$port" "systemctl start nfs-kernel-server || systemctl start nfs-server"
            fi
        else
            echo -e "${GREEN}✓ NFS сервер уже установлен на $server${NC}"
        fi
        
        # Создаем скрипт для настройки сервера, который будет перемонтировать диск с sdb на UUID
        remote_script_file="/tmp/setup_nfs_export_${uuid}.sh"
        
        echo -e "${YELLOW}Создание скрипта для настройки сервера...${NC}"
        cat << EOF > "/tmp/setup_nfs_script.sh"
#!/bin/bash
set -e

echo "Настройка сервера для использования UUID вместо имени физического диска"

# Проверка существования диска
if [ ! -e "/dev/$physical_disk" ]; then
    echo "ОШИБКА: Диск /dev/$physical_disk не существует!"
    exit 1
fi

# Проверяем UUID диска
DISK_UUID=\$(blkid -s UUID -o value /dev/$physical_disk 2>/dev/null)
if [ "\$DISK_UUID" != "$uuid" ]; then
    echo "ВНИМАНИЕ: UUID диска (\$DISK_UUID) не соответствует указанному ($uuid)"
fi

# Смотрим текущие монтирования
echo "Текущие монтирования:"
mount | grep "/mnt/storage/"

# Смотрим текущие экспорты
echo "Текущие экспорты:"
cat /etc/exports

# Создаем новую директорию для монтирования по UUID
echo "Создание директории /mnt/storage/$uuid для монтирования по UUID"
mkdir -p /mnt/storage/$uuid

# Размонтируем все пути, связанные с этим диском
umount -f -l /dev/$physical_disk 2>/dev/null || true
umount -f -l /mnt/storage/$physical_disk 2>/dev/null || true
umount -f -l /mnt/storage/sdb 2>/dev/null || true
umount -f -l /mnt/storage/$uuid 2>/dev/null || true

# Монтируем диск в новую директорию по UUID
echo "Монтирование /dev/$physical_disk в /mnt/storage/$uuid"
FS_TYPE=\$(blkid -o value -s TYPE /dev/$physical_disk 2>/dev/null)
mount -t \$FS_TYPE -o rw,noatime,nodiratime /dev/$physical_disk /mnt/storage/$uuid
chmod -R 777 /mnt/storage/$uuid

# Проверяем, что монтирование успешно
if ! mount | grep -q "/mnt/storage/$uuid"; then
    echo "ОШИБКА: Монтирование не удалось!"
    exit 1
fi

# Обновляем fstab
echo "Обновление fstab для использования UUID"
FSTAB_TMP=\$(mktemp)
grep -v "/mnt/storage/" /etc/fstab > \$FSTAB_TMP
echo "UUID=\$DISK_UUID /mnt/storage/$uuid \$FS_TYPE rw,noatime,nodiratime 0 0" >> \$FSTAB_TMP
mv \$FSTAB_TMP /etc/fstab

# Обновляем NFS экспорты
echo "Обновление NFS экспортов для использования UUID"
EXPORTS_TMP=\$(mktemp)
grep -v "/mnt/storage/" /etc/exports > \$EXPORTS_TMP
echo "/mnt/storage/$uuid 192.168.0.103(rw,sync,no_subtree_check,no_root_squash,insecure)" >> \$EXPORTS_TMP
mv \$EXPORTS_TMP /etc/exports

# Перезапускаем NFS для применения изменений
exportfs -ra
systemctl restart nfs-kernel-server || systemctl restart nfs-server

# Проверяем статус экспортов
echo "Новые экспорты:"
exportfs -v

echo "Готово! Сервер настроен для использования UUID вместо имени диска"
EOF
        
        # Копируем скрипт на сервер
        echo -e "${YELLOW}Копирование скрипта на сервер $server...${NC}"
        scp -P "$port" -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" /tmp/setup_nfs_script.sh "${SSH_USER}@${server}:${remote_script_file}" > /dev/null 2>&1
        
        if [ $? -ne 0 ]; then
            echo -e "${RED}Ошибка при копировании скрипта на сервер!${NC}"
            echo -e "${YELLOW}Пробуем альтернативный способ...${NC}"
            
            # Пробуем через временный файл и remote_exec
            tmp_script=$(mktemp)
            cat /tmp/setup_nfs_script.sh > "$tmp_script"
            remote_exec "$server" "$port" "cat > ${remote_script_file} << 'EOFSCRIPT'
$(cat $tmp_script)
EOFSCRIPT"
            rm -f "$tmp_script"
        fi
        
        # Делаем скрипт исполняемым и запускаем его
        echo -e "${YELLOW}Запуск скрипта на сервере $server...${NC}"
        remote_exec "$server" "$port" "chmod +x ${remote_script_file} && sudo ${remote_script_file}"
        
        # Удаляем временные файлы
        rm -f /tmp/setup_nfs_script.sh
        remote_exec "$server" "$port" "rm -f ${remote_script_file}" > /dev/null 2>&1
        
        echo -e "${GREEN}✓ Сервер $server успешно настроен для использования UUID вместо имени диска${NC}"
    done
    
    # Проверяем успешность настройки экспортов
    echo -e "${YELLOW}Проверка настройки NFS экспортов на всех серверах...${NC}"
    for port_entry in "${SSH_PORTS[@]}"; do
        server=$(echo $port_entry | cut -d':' -f1)
        port=$(echo $port_entry | cut -d':' -f2)
        
        echo -e "${YELLOW}Экспорты NFS на сервере $server:${NC}"
        exports=$(remote_exec "$server" "$port" "exportfs -v" | grep -v "Выполнение команды" | grep -v "✓ Команда успешно")
        
        # Проверяем, есть ли экспорты с /mnt/storage/sdb (неправильный формат)
        if echo "$exports" | grep -q "/mnt/storage/sd"; then
            echo -e "${RED}ВНИМАНИЕ: Обнаружены экспорты с использованием имени физического диска вместо UUID!${NC}"
            echo "$exports" | grep "/mnt/storage/sd"
            
            # Исправляем экспорты
            for uuid in "${DISKS_TO_MOUNT[@]}"; do
                IFS=':' read -r disk_server disk_uuid <<< "$uuid"
                if [ "$disk_server" = "$server" ]; then
                    echo -e "${YELLOW}Исправление экспортов для UUID $disk_uuid на сервере $server...${NC}"
                    
                    # Получаем диск по UUID
                    physical_disk=$(remote_exec "$server" "$port" "blkid | grep -i $disk_uuid | awk -F: '{print \$1}' | xargs basename" | grep -v "Выполнение команды" | grep -v "✓ Команда успешно" | tail -1 | tr -d '\n')
                    
                    if [ -n "$physical_disk" ]; then
                        echo -e "${YELLOW}Найден диск $physical_disk с UUID $disk_uuid${NC}"
                        
                        # Исправляем экспорты
                        remote_exec "$server" "$port" "
                            # Исправляем экспорты
                            sed -i 's|/mnt/storage/$physical_disk|/mnt/storage/$disk_uuid|g' /etc/exports
                            
                            # Создаем директорию для UUID, если не существует
                            mkdir -p /mnt/storage/$disk_uuid
                            
                            # Перемонтируем диск
                            umount -f -l /mnt/storage/$physical_disk 2>/dev/null || true
                            FS_TYPE=\$(blkid -o value -s TYPE /dev/$physical_disk 2>/dev/null)
                            mount -t \$FS_TYPE -o rw,noatime,nodiratime /dev/$physical_disk /mnt/storage/$disk_uuid
                            
                            # Обновляем экспорты
                            exportfs -ra
                        "
                    fi
                fi
            done
        else
            echo -e "${GREEN}✓ Экспорты на сервере $server настроены корректно${NC}"
        fi
    done
}

# Функция для монтирования NFS шар
mount_nfs_shares() {
    echo -e "${GREEN}Монтирование NFS шар...${NC}"
    
    # Сначала размонтируем все старые NFS шары
    echo -e "${YELLOW}Размонтирование всех существующих NFS шар...${NC}"
    
    # Размонтирование всех NFS-монтирований
    for mount_point in $(mount | grep -E 'nfs|type nfs' | awk '{print $3}'); do
        echo "Размонтирование $mount_point..."
        umount -f -l "$mount_point" 2>/dev/null || true
    done
    
    # Размонтирование всех старых точек монтирования на всякий случай
    if [ -d /mnt/storage/ ]; then
        for mount_point in $(mount | grep "/mnt/storage/" | awk '{print $3}'); do
            echo "Размонтирование старого пути $mount_point..."
            umount -f -l "$mount_point" 2>/dev/null || true
        done
    fi
    
    # Очистка /etc/fstab от всех NFS-монтирований
    echo -e "${YELLOW}Очистка fstab от NFS монтирований...${NC}"
    tmp_fstab=$(mktemp)
    grep -v ' nfs ' /etc/fstab > "$tmp_fstab"
    cp "$tmp_fstab" /etc/fstab
    rm -f "$tmp_fstab"
    
    MOUNTED_DISKS=()
    
    for disk_config in "${DISKS_TO_MOUNT[@]}"; do
        # Проверяем, является ли это RAID-конфигурацией
        if is_raid_config "$disk_config"; then
            echo -e "${YELLOW}Пропускаем RAID-конфигурацию $disk_config${NC}"
            continue
        fi
        
        # Обработка обычного диска - в формате server:uuid
        IFS=':' read -r server uuid <<< "$disk_config"
        
        # Создание точки монтирования
        mount_point="$MOUNT_BASE/$uuid"
        mkdir -p "$mount_point"
        
        # Проверяем, смонтирован ли уже этот диск
        if mount | grep -q "$mount_point"; then
            echo -e "${YELLOW}Размонтирование $mount_point...${NC}"
            umount -f -l "$mount_point" 2>/dev/null || true
        fi
        
        # Проверяем доступность NFS сервера и экспортов
        echo -e "${YELLOW}Проверка доступности NFS сервера $server...${NC}"
        if ! timeout 5 rpcinfo -p "$server" &>/dev/null; then
            echo -e "${RED}Сервер $server недоступен или не отвечает на RPC запросы${NC}"
            port=$(get_server_port "$server")
            if [ -n "$port" ]; then
                echo -e "${YELLOW}Запуск NFS сервера на $server...${NC}"
                remote_exec "$server" "$port" "systemctl restart nfs-kernel-server || systemctl restart nfs-server"
                sleep 2
            fi
        fi
        
        # Проверка наличия экспорта по UUID пути
        echo -e "${YELLOW}Проверка наличия экспорта для UUID $uuid на сервере $server...${NC}"
        
        # Запрашиваем список экспортов с сервера
        nfs_exports=$(showmount -e "$server" 2>/dev/null || echo "")
        
        # Проверяем наличие экспорта по UUID пути
        if ! echo "$nfs_exports" | grep -q "/mnt/storage/$uuid"; then
            echo -e "${RED}На сервере $server не найден экспорт по пути /mnt/storage/$uuid!${NC}"
            echo -e "${YELLOW}Доступные экспорты на сервере $server:${NC}"
            echo "$nfs_exports"
            
            # Проверяем, нет ли экспорта по физическому имени диска (sdb)
            if echo "$nfs_exports" | grep -q "/mnt/storage/sd"; then
                echo -e "${YELLOW}На сервере обнаружен экспорт по физическому имени диска!${NC}"
                echo -e "${YELLOW}Пытаемся исправить настройки сервера...${NC}"
                
                # Получаем порт для сервера
                port=$(get_server_port "$server")
                if [ -n "$port" ]; then
                    # Попытка "починить" сервер через вызов setup_nfs_exports
                    echo -e "${YELLOW}Запуск исправлений на сервере...${NC}"
                    setup_nfs_exports
                    
                    # Повторная проверка экспортов
                    nfs_exports=$(showmount -e "$server" 2>/dev/null || echo "")
                    if ! echo "$nfs_exports" | grep -q "/mnt/storage/$uuid"; then
                        echo -e "${RED}После исправлений экспорт по UUID все равно не найден!${NC}"
                        echo -e "${YELLOW}Пробуем определить физическое имя диска и выполнить монтирование по нему...${NC}"
                        
                        # Определяем имя физического диска по UUID
                        physical_disk=$(remote_exec "$server" "$port" "blkid | grep -i $uuid | awk -F: '{print \$1}' | xargs basename" | grep -v "Выполнение команды" | grep -v "✓ Команда успешно" | tail -1 | tr -d '\n')
                        
                        if [ -n "$physical_disk" ]; then
                            echo -e "${YELLOW}Найден диск $physical_disk с UUID $uuid${NC}"
                            echo -e "${YELLOW}Пробуем монтировать по физическому пути /mnt/storage/$physical_disk...${NC}"
                            
                            # Пробуем монтировать по физическому пути
                            if mount -t nfs -o "$NFS_MOUNT_OPTIONS" "$server:/mnt/storage/$physical_disk" "$mount_point"; then
                                echo -e "${GREEN}✓ Успешно смонтирован по физическому пути $server:/mnt/storage/$physical_disk в $mount_point${NC}"
                                echo -e "${YELLOW}ВНИМАНИЕ: Используется монтирование по физическому пути вместо UUID!${NC}"
                                echo -e "${YELLOW}Добавляем в /etc/fstab с правильным UUID путем для будущих монтирований${NC}"
                                
                                # Добавление в /etc/fstab с правильным UUID путем
                                echo "$server:/mnt/storage/$uuid $mount_point nfs $NFS_MOUNT_OPTIONS 0 0" >> /etc/fstab
                                MOUNTED_DISKS+=("$uuid:$mount_point")
                                continue
                            else
                                echo -e "${RED}Не удалось смонтировать диск даже по физическому имени!${NC}"
                            fi
                        else
                            echo -e "${RED}Не удалось определить физическое имя диска по UUID $uuid${NC}"
                        fi
                    fi
                fi
            fi
        fi
        
        # Для NFS сначала пробуем монтировать с обычными параметрами
        echo "Монтирование $server:/mnt/storage/$uuid в $mount_point (UUID: $uuid)"
        mount -t nfs -o "$NFS_MOUNT_OPTIONS" "$server:/mnt/storage/$uuid" "$mount_point"
        
        # Проверяем успешность монтирования
        if mount | grep -q "$mount_point"; then
            echo -e "${GREEN}✓ Успешно смонтирован /mnt/storage/$uuid с сервера $server (UUID: $uuid)${NC}"
            MOUNTED_DISKS+=("$uuid:$mount_point")
            
            # Добавление в /etc/fstab для автоматического монтирования при загрузке
            echo "$server:/mnt/storage/$uuid $mount_point nfs $NFS_MOUNT_OPTIONS 0 0" >> /etc/fstab
            continue
        else
            echo -e "${YELLOW}! Не удалось смонтировать $server:/mnt/storage/$uuid, пробуем с другими параметрами...${NC}"
            
            # Пробуем монтировать с другими параметрами
            mount -t nfs -o "$NFS_MOUNT_OPTIONS,nocto,noac" "$server:/mnt/storage/$uuid" "$mount_point"
            
            if mount | grep -q "$mount_point"; then
                echo -e "${GREEN}✓ Успешно смонтирован /mnt/storage/$uuid с сервера $server при повторной попытке (UUID: $uuid)${NC}"
                MOUNTED_DISKS+=("$uuid:$mount_point")
                
                # Добавление в /etc/fstab для автоматического монтирования при загрузке
                echo "$server:/mnt/storage/$uuid $mount_point nfs $NFS_MOUNT_OPTIONS,nocto,noac 0 0" >> /etc/fstab
                continue
            else
                echo -e "${RED}! Вторая попытка монтирования не удалась, пробуем сбросить экспорты на сервере...${NC}"
                
                # Пробуем сбросить экспорты на сервере
                port=$(get_server_port "$server")
                if [ -n "$port" ]; then
                    reset_exports "$server" "$port"
                    
                    # Пробуем монтировать после сброса экспортов
                    mount -t nfs -o "$NFS_MOUNT_OPTIONS" "$server:/mnt/storage/$uuid" "$mount_point"
                    
                    if mount | grep -q "$mount_point"; then
                        echo -e "${GREEN}✓ Успешно смонтирован /mnt/storage/$uuid с сервера $server после сброса экспортов (UUID: $uuid)${NC}"
                        MOUNTED_DISKS+=("$uuid:$mount_point")
                        
                        # Добавление в /etc/fstab для автоматического монтирования при загрузке
                        echo "$server:/mnt/storage/$uuid $mount_point nfs $NFS_MOUNT_OPTIONS 0 0" >> /etc/fstab
                        continue
                    else
                        echo -e "${RED}✗ Все попытки монтирования не удались${NC}"
                        
                        # Проверка физического пути как последний вариант
                        physical_disk=$(remote_exec "$server" "$port" "blkid | grep -i $uuid | awk -F: '{print \$1}' | xargs basename" | grep -v "Выполнение команды" | grep -v "✓ Команда успешно" | tail -1 | tr -d '\n')
                        
                        if [ -n "$physical_disk" ]; then
                            echo -e "${YELLOW}Найден диск $physical_disk с UUID $uuid${NC}"
                            echo -e "${YELLOW}Пробуем последнюю попытку монтирования по физическому пути...${NC}"
                            
                            if mount -t nfs -o "$NFS_MOUNT_OPTIONS" "$server:/mnt/storage/$physical_disk" "$mount_point"; then
                                echo -e "${GREEN}✓ Успешно смонтирован по физическому пути $server:/mnt/storage/$physical_disk в $mount_point${NC}"
                                echo -e "${YELLOW}ВНИМАНИЕ: Используется монтирование по физическому пути вместо UUID!${NC}"
                                echo -e "${YELLOW}Добавляем в /etc/fstab с правильным UUID путем для будущих монтирований${NC}"
                                
                                # Добавление в /etc/fstab с правильным UUID путем
                                echo "$server:/mnt/storage/$uuid $mount_point nfs $NFS_MOUNT_OPTIONS 0 0" >> /etc/fstab
                                MOUNTED_DISKS+=("$uuid:$mount_point")
                                continue
                            fi
                        fi
                        
                        # Показываем детальную информацию для диагностики
                        echo -e "${YELLOW}Диагностика проблемы монтирования...${NC}"
                        echo -e "1. Проверка RPC на сервере $server:"
                        timeout 5 rpcinfo -p "$server" || echo "Не удалось получить RPC информацию"
                        
                        echo -e "2. Проверка экспортов на сервере $server:"
                        timeout 5 showmount -e "$server" || echo "Не удалось получить список экспортов"
                        
                        echo -e "3. Попытка с подробным выводом:"
                        mount -v -t nfs -o "$NFS_MOUNT_OPTIONS" "$server:/mnt/storage/$uuid" "$mount_point"
                    fi
                else
                    echo -e "${RED}✗ Не удалось определить порт SSH для сервера $server${NC}"
                fi
            fi
        fi
    done
    
    if [ ${#MOUNTED_DISKS[@]} -eq 0 ]; then
        echo -e "${RED}✗ Не удалось смонтировать ни один диск${NC}"
        return 1
    else
        echo -e "${GREEN}✓ Успешно смонтировано ${#MOUNTED_DISKS[@]} дисков${NC}"
        echo -e "${GREEN}✓ Все диски теперь монтируются с использованием UUID вместо букв дисков${NC}"
        return 0
    fi
}

# Функция для обновления конфигурации бэкенда
update_backend_config() {
    if [ -z "$CONFIG_PATH" ]; then
        echo -e "${RED}ОШИБКА: Не указан путь к конфигурационному файлу${NC}"
        return 1
    fi
    
    echo -e "${GREEN}Обновление конфигурации бэкенда: $CONFIG_PATH${NC}"
    
    # Проверка существования файла
    if [ ! -f "$CONFIG_PATH" ]; then
        echo -e "${YELLOW}Создание нового конфигурационного файла${NC}"
        touch "$CONFIG_PATH"
    else
        echo -e "${YELLOW}Создание резервной копии конфигурационного файла${NC}"
        cp "$CONFIG_PATH" "${CONFIG_PATH}.backup_$(date +"%Y%m%d%H%M%S")"
    fi
    
    # Создание строки конфигурации дисков
    local DISKS_CONFIG=""
    
    # Если у нас есть смонтированные диски из setup_exports, используем их
    if [ ${#BACKEND_DISKS[@]} -gt 0 ]; then
        echo -e "${GREEN}Использование смонтированных дисков для конфигурации (${#BACKEND_DISKS[@]})${NC}"
        
        # Формат BACKEND_DISKS: "буква:путь_монтирования"
        for disk_entry in "${BACKEND_DISKS[@]}"; do
            IFS=':' read -r letter mount_point <<< "$disk_entry"
            
            # Проверка формата буквы
            if [ ${#letter} -ne 1 ]; then
                echo -e "${YELLOW}Пропускаем некорректную запись: $disk_entry${NC}"
                continue
            fi
            
            # Проверка существования точки монтирования
            if [ ! -d "$mount_point" ]; then
                echo -e "${YELLOW}Точка монтирования $mount_point не существует, пропускаем${NC}"
                continue
            fi
            
            if [ -n "$DISKS_CONFIG" ]; then
                DISKS_CONFIG="$DISKS_CONFIG, "
            fi
            
            # Использование буквы в ключе и UUID в пути
            echo -e "${GREEN}Добавление диска $letter в конфигурацию: $mount_point${NC}"
            DISKS_CONFIG="${DISKS_CONFIG}\"$letter\": \"$mount_point\""
        done
    # Если BACKEND_DISKS пусто, пробуем использовать DISKS_TO_MOUNT
    elif [ ${#DISKS_TO_MOUNT[@]} -gt 0 ]; then
        echo -e "${YELLOW}Нет смонтированных дисков, используем DISKS_TO_MOUNT (${#DISKS_TO_MOUNT[@]})${NC}"
        
        for disk_config in "${DISKS_TO_MOUNT[@]}"; do
            # Пропускаем RAID конфигурации
            if is_raid_config "$disk_config"; then
                echo -e "${YELLOW}Пропускаем RAID конфигурацию: $disk_config${NC}"
                continue
            fi
            
            # Обработка обычного диска - в формате server:uuid
            IFS=':' read -r server uuid <<< "$disk_config"
            
            # Получаем порт для сервера
            local port=$(get_server_port "$server")
            if [ -z "$port" ]; then
                echo -e "${RED}Ошибка: Не найден порт для сервера $server${NC}"
                continue
            fi
            
            # Определяем имя физического устройства по UUID
            echo -e "${YELLOW}Определение физического устройства по UUID на сервере $server...${NC}"
            local physical_disk=""
            physical_disk=$(remote_exec "$server" "$port" "blkid | grep -i $uuid | awk -F: '{print \$1}' | xargs basename")
            
            if [[ -z "$physical_disk" ]]; then
                echo -e "${RED}ОШИБКА: Не удалось найти устройство с UUID $uuid на сервере $server${NC}"
                continue
            else
                echo -e "${GREEN}✓ Найдено устройство $physical_disk с UUID $uuid на сервере $server${NC}"
            fi
            
            # Определяем буквенное обозначение на основе найденного имени диска
            local letter=""
            if [[ "$physical_disk" == "sdb" ]]; then
                letter="C"
            elif [[ "$physical_disk" == "sdc" ]]; then
                letter="D"
            else
                # Для других дисков используем следующую доступную букву
                letter="C"  # По умолчанию
            fi
            
            # Точка монтирования по UUID
            mount_point="$MOUNT_BASE/$uuid"
            
            if [ -n "$DISKS_CONFIG" ]; then
                DISKS_CONFIG="$DISKS_CONFIG, "
            fi
            
            echo -e "${GREEN}Добавление диска $letter в конфигурацию: $mount_point${NC}"
            DISKS_CONFIG="${DISKS_CONFIG}\"$letter\": \"$mount_point\""
        done
    else
        echo -e "${YELLOW}Нет доступных дисков для конфигурации${NC}"
    fi
    
    # Добавление RAID массивов, если они настроены
    if [ ${#CONFIGURED_RAIDS[@]} -gt 0 ]; then
        echo -e "${GREEN}Добавление RAID массивов в конфигурацию (${#CONFIGURED_RAIDS[@]})${NC}"
        
        for raid_config in "${CONFIGURED_RAIDS[@]}"; do
            IFS=':' read -r raid_name raid_mount_point <<< "$raid_config"
            
            # Проверка существования точки монтирования RAID
            if [ ! -d "$raid_mount_point" ]; then
                echo -e "${YELLOW}Точка монтирования RAID $raid_mount_point не существует, пропускаем${NC}"
                continue
            fi
            
            # Определяем букву для RAID (обычно E, F, G...)
            local raid_letter="E"  # По умолчанию используем E для первого RAID
            
            if [ -n "$DISKS_CONFIG" ]; then
                DISKS_CONFIG="$DISKS_CONFIG, "
            fi
            
            echo -e "${GREEN}Добавление RAID $raid_name в конфигурацию: $raid_mount_point${NC}"
            DISKS_CONFIG="${DISKS_CONFIG}\"$raid_letter\": \"$raid_mount_point\""
        done
    fi
    
    # Удаление последней запятой, если она есть
    DISKS_CONFIG="${DISKS_CONFIG%,}"
    
    # Формирование итоговой конфигурации
    local CONFIG_CONTENT="
{
    \"performance\": {
        \"max_concurrent_jobs\": ${MAX_CONCURRENT_JOBS:-10}
    },
    \"disks\": {
        $DISKS_CONFIG
    }
}
"
    
    # Запись конфигурации в файл
    echo "$CONFIG_CONTENT" > "$CONFIG_PATH"
    
    echo -e "${GREEN}✓ Конфигурация бэкенда успешно обновлена${NC}"
    echo -e "${YELLOW}Конфигурация дисков:${NC}"
    echo "$DISKS_CONFIG"
    
    return 0
}

# Функция для монтирования дисков
mount_disks() {
    echo -e "${GREEN}Монтирование дисков...${NC}"
    
    # Сначала создаем базовую директорию для монтирования
    mkdir -p "$MOUNT_BASE"
    
    # Массив для хранения успешно смонтированных дисков
    declare -a MOUNTED_DISKS
    
    # Обработка каждого диска
    for disk_config in "${DISKS_TO_MOUNT[@]}"; do
        echo -e "${YELLOW}Обработка конфигурации: $disk_config${NC}"
        
        # Проверяем, является ли это RAID-конфигурацией
        if is_raid_config "$disk_config"; then
            echo -e "${YELLOW}RAID конфигурация обрабатывается отдельно${NC}"
            continue
        fi
        
        # Разбираем информацию о диске
        IFS=':' read -r server uuid <<< "$disk_config"
        
        echo -e "${GREEN}===== Монтирование диска с сервера $server =====${NC}"
        
        # Создаем точку монтирования
        mount_point="$MOUNT_BASE/$uuid"
        mkdir -p "$mount_point"
        
        # Проверяем, смонтирован ли уже диск
        if mount | grep -q "$mount_point"; then
            echo -e "${YELLOW}Размонтирование $mount_point...${NC}"
            umount -f -l "$mount_point" 2>/dev/null || true
        fi
        
        # Для NFS сначала пробуем монтировать с обычными параметрами
        echo "Монтирование $server:/mnt/storage/$uuid в $mount_point (UUID: $uuid)"
        mount -t nfs -o "$NFS_MOUNT_OPTIONS" "$server:/mnt/storage/$uuid" "$mount_point"
        
        # Проверяем успешность монтирования
        if mount | grep -q "$mount_point"; then
            echo -e "${GREEN}✓ Успешно смонтирован /mnt/storage/$uuid с сервера $server (UUID: $uuid)${NC}"
            MOUNTED_DISKS+=("$uuid:$mount_point")
            continue
        else
            echo -e "${YELLOW}! Не удалось смонтировать $server:/mnt/storage/$uuid, пробуем с другими параметрами...${NC}"
            
            # Пробуем монтировать с другими параметрами
            mount -t nfs -o "$NFS_MOUNT_OPTIONS,nocto,noac" "$server:/mnt/storage/$uuid" "$mount_point"
            
            if mount | grep -q "$mount_point"; then
                echo -e "${GREEN}✓ Успешно смонтирован /mnt/storage/$uuid с сервера $server при повторной попытке (UUID: $uuid)${NC}"
                MOUNTED_DISKS+=("$uuid:$mount_point")
                continue
            else
                echo -e "${RED}! Вторая попытка монтирования не удалась, пробуем сбросить экспорты на сервере...${NC}"
                
                # Пробуем сбросить экспорты на сервере
                port=$(get_server_port "$server")
                if [ -n "$port" ]; then
                    reset_exports "$server" "$port"
                    
                    # Пробуем монтировать после сброса экспортов
                    mount -t nfs -o "$NFS_MOUNT_OPTIONS" "$server:/mnt/storage/$uuid" "$mount_point"
                    
                    if mount | grep -q "$mount_point"; then
                        echo -e "${GREEN}✓ Успешно смонтирован /mnt/storage/$uuid с сервера $server после сброса экспортов (UUID: $uuid)${NC}"
                        MOUNTED_DISKS+=("$uuid:$mount_point")
                        continue
                    fi
                fi
                
                echo -e "${RED}✗ Все попытки монтирования диска с сервера $server не удались${NC}"
            fi
        fi
    done
    
    # Экспорт массива смонтированных дисков для использования в других функциях
    export MOUNTED_DISKS
    
    echo -e "${GREEN}Монтирование дисков завершено${NC}"
    return 0
} 