#!/bin/bash

# Скрипт создания бэкапа и отправки статуса через API
# Использование: ./make_backup.sh disk_name backup_path api_key api_url [interval]

# Проверка аргументов
if [ $# -lt 4 ]; then
    echo "Использование: $0 disk_name backup_path api_key api_url [interval]"
    exit 1
fi

DISK_NAME="$1"
BACKUP_PATH="$2"
API_KEY="$3"
API_URL="$4"
INTERVAL="${5:-daily}"

# Путь для логов
LOG_DIR="/var/log/iqbanana_backups"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${DISK_NAME}_backup.log"

# Функция для отправки статуса через API
send_backup_status() {
    local status="$1"
    local message="$2"
    
    # Формируем JSON для отправки
    json_data="{\"diskName\":\"$DISK_NAME\",\"status\":\"$status\",\"message\":\"$message\"}"
    
    # Отправляем запрос на API
    response=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-KEY: $API_KEY" \
        -d "$json_data" \
        "${API_URL}/api/system/backup-status")
    
    # Проверяем ответ (опционально)
    echo "API response: $response" >> "$LOG_FILE"
}

# Запись в лог с датой
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Очистка старых резервных копий (оставляем только последние 5)
cleanup_old_backups() {
    # Получаем список файлов бэкапов для данного диска
    backup_files=$(find "$BACKUP_PATH" -name "${DISK_NAME}_backup_*.tar.gz" | sort)
    
    # Подсчитываем количество файлов
    count=$(echo "$backup_files" | wc -l)
    
    # Если файлов больше 5, удаляем самые старые
    if [ "$count" -gt 5 ]; then
        # Количество файлов для удаления
        remove_count=$((count - 5))
        
        # Получаем список файлов для удаления (самые старые)
        files_to_remove=$(echo "$backup_files" | head -n "$remove_count")
        
        # Удаляем каждый файл
        echo "$files_to_remove" | while read -r file; do
            log_message "Удаление старого бэкапа: $file"
            rm -f "$file"
        done
    fi
}

# Функция для поиска точки монтирования диска по UUID
find_mountpoint() {
    local uuid="$1"
    local possible_paths=(
        "/mnt/$uuid"
        "/mnt/storage/$uuid"
        "/mnt/disks/$uuid"
    )
    
    # Проверяем возможные пути монтирования
    for path in "${possible_paths[@]}"; do
        if mountpoint -q "$path"; then
            echo "$path"
            return 0
        fi
    done
    
    # Если не нашли в стандартных местах, ищем с помощью mount
    local mount_path=$(mount | grep -i "$uuid" | awk '{print $3}' | head -1)
    if [ -n "$mount_path" ]; then
        echo "$mount_path"
        return 0
    fi
    
    # Если не нашли, пробуем найти с помощью find по UUID
    local found_path=$(find /mnt -type d -name "*$uuid*" 2>/dev/null | head -1)
    if [ -n "$found_path" ] && mountpoint -q "$found_path"; then
        echo "$found_path"
        return 0
    fi
    
    # Если ничего не нашли, возвращаем ошибку
    return 1
}

# Функция для создания бэкапа
make_backup() {
    # Формируем имя файла бэкапа с текущей датой
    DATE_SUFFIX=$(date '+%Y%m%d_%H%M%S')
    BACKUP_FILE="${BACKUP_PATH}/${DISK_NAME}_backup_${DATE_SUFFIX}.tar.gz"
    
    # Ищем точку монтирования диска
    DISK_MOUNTPOINT=$(find_mountpoint "$DISK_NAME")
    
    if [ -z "$DISK_MOUNTPOINT" ]; then
        log_message "ОШИБКА: Диск с UUID ${DISK_NAME} не найден или не смонтирован"
        log_message "Проверьте, что диск смонтирован по одному из путей: /mnt/$DISK_NAME, /mnt/storage/$DISK_NAME или другому пути"
        send_backup_status "ERROR" "Диск с UUID ${DISK_NAME} не найден или не смонтирован"
        return 1
    fi
    
    # Отправляем статус о начале бэкапа
    send_backup_status "PROCESSING" "Начало резервного копирования"
    log_message "Начало создания бэкапа для диска ${DISK_NAME}"
    log_message "Найдена точка монтирования диска: $DISK_MOUNTPOINT"
    
    # Создаем каталог бэкапов если его нет
    mkdir -p "$BACKUP_PATH"
    
    # Создаём бэкап
    SOURCE_DIR="$(dirname "$DISK_MOUNTPOINT")"
    SOURCE_BASE="$(basename "$DISK_MOUNTPOINT")"
    
    if tar -czf "$BACKUP_FILE" -C "$SOURCE_DIR" "$SOURCE_BASE"; then
        log_message "Бэкап успешно создан: $BACKUP_FILE"
        
        # Очистка старых бэкапов
        cleanup_old_backups
        
        # Отправляем статус об успешном создании бэкапа
        send_backup_status "SUCCESS" "Бэкап успешно создан: $(basename "$BACKUP_FILE")"
        return 0
    else
        log_message "ОШИБКА при создании бэкапа"
        send_backup_status "ERROR" "Ошибка при создании бэкапа"
        return 1
    fi
}

# Выполняем бэкап
make_backup

exit $? 