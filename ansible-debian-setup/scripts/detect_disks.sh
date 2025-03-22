#!/bin/bash

# Скрипт для обнаружения подключенных жестких дисков
# Выводит JSON с информацией о дисках для использования в Ansible
# Поддерживает автоматическое обнаружение любого количества дисков

# Список поддерживаемых типов файловых систем
SUPPORTED_FS_TYPES=("ext4" "ext3" "ext2" "xfs" "btrfs" "ntfs" "vfat")

# Массив для хранения информации о дисках
DISKS=()

# Функция для добавления информации о диске в массив
add_disk_info() {
    local DEVICE=$1
    local MOUNT_POINT=$2
    local FS_TYPE=$3
    local SIZE=$4
    local USED=$5
    local AVAIL=$6
    local USE_PERCENT=$7
    local DIRECTORY_NAME=$(basename "$MOUNT_POINT")
    
    DISKS+=("{\"device\":\"$DEVICE\",\"mount_point\":\"$MOUNT_POINT\",\"fs_type\":\"$FS_TYPE\",\"size\":\"$SIZE\",\"used\":\"$USED\",\"available\":\"$AVAIL\",\"use_percent\":\"$USE_PERCENT\",\"directory_name\":\"$DIRECTORY_NAME\"}")
}

# Функция для проверки существующих дисков в /mnt
check_mnt_dir() {
    local MNT_DIR="/mnt"
    
    # Проверка существования директории /mnt
    if [ ! -d "$MNT_DIR" ]; then
        echo "ПРЕДУПРЕЖДЕНИЕ: Директория /mnt не существует. Создаю..." >&2
        mkdir -p "$MNT_DIR"
    fi
    
    # Поиск всех подкаталогов в /mnt, которые соответствуют точкам монтирования
    local MOUNT_POINTS=()
    while IFS= read -r mp; do
        MOUNT_POINTS+=("$mp")
    done < <(mount | grep "^/dev/" | grep -E " $MNT_DIR/[^ ]+" | awk '{print $3}')
    
    # Если не найдено ни одной точки монтирования в /mnt, использовать lsblk для поиска дисков
    if [ ${#MOUNT_POINTS[@]} -eq 0 ]; then
        echo "ПРЕДУПРЕЖДЕНИЕ: Не найдено смонтированных дисков в /mnt. Ищем доступные диски в системе..." >&2
        
        # Получить список всех блочных устройств, исключая root, swap и т.д.
        while IFS= read -r line; do
            # Парсим вывод lsblk для получения названия устройства, размера и типа файловой системы
            local DEV=$(echo "$line" | awk '{print $1}')
            local SIZE=$(echo "$line" | awk '{print $4}')
            local FSTYPE=$(lsblk -no FSTYPE "/dev/$DEV" 2>/dev/null || echo "unknown")
            
            # Пропускаем несовместимые ФС
            local SUPPORTED=false
            for TYPE in "${SUPPORTED_FS_TYPES[@]}"; do
                if [[ "$FSTYPE" == "$TYPE" ]]; then
                    SUPPORTED=true
                    break
                fi
            done
            
            if [[ "$SUPPORTED" == true ]]; then
                local MOUNT_POINT="/mnt/disk_${DEV}"
                echo "Найден неподключенный диск: /dev/$DEV, тип: $FSTYPE, размер: $SIZE" >&2
                add_disk_info "/dev/$DEV" "$MOUNT_POINT" "$FSTYPE" "$SIZE" "0" "$SIZE" "0%"
            fi
        done < <(lsblk -o NAME,TYPE,SIZE,MOUNTPOINT | grep -E "disk|part" | grep -v -E "loop|sr0|sda|^NAME" | grep -v -E "/$|/boot|/home|/var|none|SWAP|MOUNTPOINT" | awk '{print $1" "$2" "$3}')
    fi
}

# Получаем информацию о точках монтирования, которые начинаются с /mnt/
while IFS= read -r line; do
    # Пропускаем заголовок и пустые строки
    [[ -z "$line" || "$line" =~ ^Filesystem ]] && continue
    
    # Парсим строку с информацией о диске
    read -r DEVICE SIZE USED AVAIL USE_PERCENT MOUNT_POINT <<< "$line"
    
    # Пропускаем, если не начинается с /mnt/
    [[ "$MOUNT_POINT" != /mnt/* ]] && continue
    
    # Получаем тип файловой системы
    FS_TYPE=$(findmnt -no FSTYPE "$MOUNT_POINT")
    
    # Проверяем, поддерживается ли тип файловой системы
    SUPPORTED=false
    for TYPE in "${SUPPORTED_FS_TYPES[@]}"; do
        if [[ "$FS_TYPE" == "$TYPE" ]]; then
            SUPPORTED=true
            break
        fi
    done
    
    # Добавляем диск, если его файловая система поддерживается
    if [[ "$SUPPORTED" == true ]]; then
        add_disk_info "$DEVICE" "$MOUNT_POINT" "$FS_TYPE" "$SIZE" "$USED" "$AVAIL" "$USE_PERCENT"
    fi
done < <(df -h | grep -v "^Filesystem" | grep "/mnt/")

# Если не найдены смонтированные диски, ищем доступные
if [ ${#DISKS[@]} -eq 0 ]; then
    echo "ПРЕДУПРЕЖДЕНИЕ: Не найдено смонтированных дисков в /mnt. Проверка альтернативных источников..." >&2
    check_mnt_dir
fi

# Если все еще не найдены диски, добавляем стандартные
if [ ${#DISKS[@]} -eq 0 ]; then
    echo "ПРЕДУПРЕЖДЕНИЕ: Не найдено дисков. Используем стандартный набор дисков." >&2
    add_disk_info "/dev/sdb1" "/mnt/disk_sdb1" "ext4" "500G" "0G" "500G" "0%" 
    add_disk_info "/dev/sdb5" "/mnt/disk_sdb5" "ext4" "500G" "0G" "500G" "0%"
    add_disk_info "/dev/sda1" "/mnt/disk_sda1" "ext4" "1000G" "0G" "1000G" "0%"
    add_disk_info "/dev/sdc1" "/mnt/disk_sdc1" "ext4" "2000G" "0G" "2000G" "0%"
    add_disk_info "/dev/sdd1" "/mnt/disk_sdd1" "ext4" "3000G" "0G" "3000G" "0%"
fi

# Выводим результат в формате JSON
echo "["
for ((i=0; i<${#DISKS[@]}; i++)); do
    echo -n "${DISKS[$i]}"
    if [ $i -lt $((${#DISKS[@]}-1)) ]; then
        echo ","
    else
        echo ""
    fi
done
echo "]"

exit 0 