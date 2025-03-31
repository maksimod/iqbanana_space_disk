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
    
    for disk_config in "${DISKS_TO_MOUNT[@]}"; do
        echo -e "${YELLOW}Обработка конфигурации: $disk_config${NC}"
        
        # Проверяем, является ли это RAID-конфигурацией
        if is_raid_config "$disk_config"; then
            echo -e "${YELLOW}Пропускаем RAID-конфигурацию: $disk_config${NC}"
            continue
        fi
        
        # Обработка обычного диска
        IFS=':' read -r server disk letter <<< "$disk_config"
        
        echo -e "${GREEN}===== Настройка сервера $server для диска $disk =====${NC}"
        
        # Получаем порт для сервера
        local port=$(echo "${SSH_PORTS[@]}" | grep -o "$server:[0-9]*" | cut -d':' -f2)
        if [ -z "$port" ]; then
            echo -e "${RED}Ошибка: Не найден порт для сервера $server${NC}"
            continue
        fi
        
        # Проверяем существование диска
        echo -e "${YELLOW}Проверка существования диска /dev/$disk на сервере $server...${NC}"
        disk_exists=$(remote_exec "$server" "$port" "[ -e /dev/$disk ] && echo 'exists' || echo 'not_exists'")
        echo -e "${YELLOW}Результат проверки: $disk_exists${NC}"
        
        if [ "$disk_exists" != "exists" ]; then
            echo -e "${RED}ОШИБКА: Диск /dev/$disk не существует на сервере $server${NC}"
            echo -e "${YELLOW}Список доступных дисков:${NC}"
            remote_exec "$server" "$port" "ls -l /dev/sd* 2>/dev/null || echo 'Диски не найдены'"
            continue
        fi
        
        # Настройка сервера
        server_cmd="
        echo \"Настройка диска $disk на сервере $server\"
        
        # Проверяем существование диска
        if [ ! -e \"/dev/$disk\" ]; then
            echo \"ОШИБКА: Диск /dev/$disk не существует!\"
            exit 1
        fi
        
        # Создаем точку монтирования
        mkdir -p /mnt/storage/$disk
        
        # Проверяем UUID диска
        UUID=\$(blkid -s UUID -o value /dev/$disk 2>/dev/null)
        FS_TYPE=\$(blkid -o value -s TYPE /dev/$disk 2>/dev/null)
        
        echo \"Тип файловой системы: \$FS_TYPE\"
        echo \"UUID диска: \$UUID\"
        
        if [ -z \"\$FS_TYPE\" ]; then
            echo \"Диск /dev/$disk не содержит файловой системы. Создаем XFS...\"
            mkfs.xfs -f /dev/$disk
            FS_TYPE=\"xfs\"
            UUID=\$(blkid -s UUID -o value /dev/$disk)
            echo \"Новый UUID диска: \$UUID\"
        fi
        
        if [ -z \"\$UUID\" ]; then
            echo \"ОШИБКА: Не удалось получить UUID для диска /dev/$disk\"
            exit 1
        fi
        
        echo \"Монтирование /dev/$disk (\$FS_TYPE, UUID=\$UUID) в /mnt/storage/$disk\"
        
        # Размонтируем диск если он уже смонтирован
        if mount | grep -q \"/dev/$disk on\"; then
            echo \"Размонтирование существующего /dev/$disk\"
            umount -f -l /dev/$disk 2>/dev/null || true
        fi
        
        # Монтируем диск
        mount -t \$FS_TYPE -o $MOUNT_OPTIONS /dev/$disk /mnt/storage/$disk
        
        # Проверка монтирования
        if mount | grep -q \"/dev/$disk on /mnt/storage/$disk\"; then
            echo \"✓ Диск /dev/$disk успешно смонтирован\"
            
            # Обновляем fstab
            grep -v \"/mnt/storage/$disk\" /etc/fstab > /tmp/fstab.new
            mv /tmp/fstab.new /etc/fstab
            echo \"UUID=\$UUID /mnt/storage/$disk \$FS_TYPE $MOUNT_OPTIONS 0 0\" >> /etc/fstab
            
            # Настройка прав доступа
            chmod -R 777 /mnt/storage/$disk
        else
            echo \"✗ Ошибка монтирования диска /dev/$disk\"
            exit 1
        fi
        
        # Настройка NFS экспорта
        grep -v \"/mnt/storage/$disk $CLIENT_IP\" /etc/exports > /tmp/exports.new || echo \"# NFS exports\" > /tmp/exports.new
        mv /tmp/exports.new /etc/exports
        echo \"/mnt/storage/$disk $CLIENT_IP(rw,sync,no_subtree_check,no_root_squash,insecure)\" >> /etc/exports
        
        # Перезапуск NFS
        exportfs -ra
        systemctl restart nfs-kernel-server
        
        # Проверка экспортов
        echo \"Экспорты NFS:\"
        exportfs -v
        "
        
        # Выполнение команды на сервере
        if ! remote_exec "$server" "$port" "$server_cmd"; then
            echo -e "${RED}Ошибка при настройке сервера $server${NC}"
            continue
        fi
    done
}

# Функция для монтирования NFS шар
mount_nfs_shares() {
    echo -e "${GREEN}Монтирование NFS шар...${NC}"
    
    # Очистка fstab от старых записей
    cp /etc/fstab /etc/fstab.backup_$(date +"%Y%m%d%H%M%S")
    grep -v "$MOUNT_BASE" /etc/fstab > /tmp/fstab.new
    cp /tmp/fstab.new /etc/fstab
    
    # Добавляем комментарий о NFS монтированиях
    echo "# NFS монтирования" >> /etc/fstab
    
    # Массив для хранения информации о монтированиях для backend
    declare -a BACKEND_DISKS
    
    # Проверка, установлен ли nfs-common
    if ! command -v mount.nfs &> /dev/null; then
        echo "Утилита nfs-common не установлена. Устанавливаем..."
        apt-get update && apt-get install -y nfs-common
    fi
    
    # Сначала обрабатываем настроенные RAID-массивы, если они есть
    if [ -n "${CONFIGURED_RAIDS}" ]; then
        for raid_mount in "${CONFIGURED_RAIDS[@]}"; do
            IFS=':' read -r server mount_path letter <<< "$raid_mount"
            echo "Обработка RAID-монтирования: $raid_mount"
            BACKEND_DISKS+=("$letter:$mount_path")
        done
    fi
    
    # Затем обрабатываем обычные диски
    for disk_config in "${DISKS_TO_MOUNT[@]}"; do
        # Пропускаем RAID-конфигурации
        if is_raid_config "$disk_config"; then
            continue
        fi
        
        # Обработка обычного диска
        IFS=':' read -r server disk letter <<< "$disk_config"
        
        mount_point="$MOUNT_BASE/$server/$(basename /mnt/storage/$disk)"
        
        # Создание точки монтирования
        mkdir -p $mount_point
        
        # Размонтирование, если уже смонтировано
        if mount | grep -q " on $mount_point "; then
            echo "Размонтирование существующего $mount_point..."
            umount -f -l $mount_point 2>/dev/null || true
        fi
        
        # Монтирование
        echo "Монтирование $server:/mnt/storage/$disk в $mount_point (Буква: $letter)"
        mount -t nfs -o $NFS_MOUNT_OPTIONS $server:/mnt/storage/$disk $mount_point
        
        if mount | grep -q " on $mount_point "; then
            echo -e "${GREEN}✓ Успешно смонтирован /mnt/storage/$disk с сервера $server (Буква: $letter)${NC}"
            # Добавление в fstab
            echo "$server:/mnt/storage/$disk $mount_point nfs $NFS_MOUNT_OPTIONS 0 0" >> /etc/fstab
            # Добавление в массив для конфигурации backend
            BACKEND_DISKS+=("$letter:$mount_point")
        else
            echo -e "${RED}✗ Ошибка монтирования /mnt/storage/$disk с сервера $server${NC}"
            echo -e "${YELLOW}Проверка доступности NFS:${NC}"
            showmount -e $server
        fi
    done
    
    # Экспорт массива дисков для backend
    export BACKEND_DISKS
}

# Функция для обновления конфигурации backend
update_backend_config() {
    echo -e "${GREEN}Обновление конфигурации backend...${NC}"
    
    if [ -f "$CONFIG_PATH" ]; then
        echo "Найден файл конфигурации backend: $CONFIG_PATH"
        
        # Создание резервной копии
        cp "$CONFIG_PATH" "${CONFIG_PATH}.bak_$(date +"%Y%m%d%H%M%S")"
        
        # Создаем строки для конфигурации дисков
        DISKS_CONFIG=""
        for disk_config in "${DISKS_TO_MOUNT[@]}"; do
            if ! is_raid_config "$disk_config"; then
                IFS=':' read -r server disk letter <<< "$disk_config"
                mount_point="$MOUNT_BASE/$server/$(basename /mnt/storage/$disk)"
                DISKS_CONFIG="${DISKS_CONFIG}            '$letter:': '$mount_point',\n"
            fi
        done
        
        # Удаляем запятую с последней строки
        DISKS_CONFIG=$(echo -e "$DISKS_CONFIG" | sed '$ s/,$//')
        
        # Создаем новый конфигурационный файл
        cat > "$CONFIG_PATH" << EOF
// Конфигурация приложения
const config = {
  // Базовые настройки
  server: {
    port: process.env.PORT || 6005,
    allowedOrigins: [
      'http://46.35.241.37:6001', 
      'http://localhost:6001',
      'https://iqbanana.online',
      'http://iqbanana.online'
    ]
  },

  // Версия API
  apiVersion: 'v1',

  // Пути к смонтированным дискам на веб-сервере
  disks: {
$(echo -e "$DISKS_CONFIG")
  },

  // Настройки производительности для файловых операций
  performance: {
    maxFileSize: 20 * 1024 * 1024 * 1024, // 20GB максимальный размер файла
    chunkSize: 5 * 1024 * 1024, // 5MB размер чанка по умолчанию для больших файлов
    maxConcurrentUploads: 5, // Максимальное количество одновременных загрузок
    uploadTimeout: 3600000, // 1 час таймаут для загрузки полного файла
    chunkTimeout: 600000, // 10 минут таймаут для загрузки чанка
    readBufferSize: 4096 * 1024, // 4 MB буфер для чтения файлов
    writeBufferSize: 8192 * 1024 // 8 MB буфер для записи файлов
  }
};

module.exports = config;
EOF
        
        echo -e "${GREEN}✓ Конфигурация backend обновлена успешно${NC}"
        echo "Содержимое конфигурации дисков:"
        grep -A 10 "disks: {" "$CONFIG_PATH"
    else
        echo -e "${YELLOW}⚠️ Файл конфигурации backend не найден: $CONFIG_PATH${NC}"
    fi
} 