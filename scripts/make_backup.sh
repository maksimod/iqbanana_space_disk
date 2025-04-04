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

# Функция для создания бэкапа
make_backup() {
    # Формируем имя файла бэкапа с текущей датой
    DATE_SUFFIX=$(date '+%Y%m%d_%H%M%S')
    BACKUP_FILE="${BACKUP_PATH}/${DISK_NAME}_backup_${DATE_SUFFIX}.tar.gz"
    
    # Проверяем, смонтирован ли исходный диск
    if ! mountpoint -q "/mnt/${DISK_NAME}"; then
        log_message "ОШИБКА: Диск ${DISK_NAME} не смонтирован"
        send_backup_status "ERROR" "Диск ${DISK_NAME} не смонтирован"
        return 1
    fi
    
    # Отправляем статус о начале бэкапа
    send_backup_status "PROCESSING" "Начало резервного копирования"
    log_message "Начало создания бэкапа для диска ${DISK_NAME}"
    
    # Создаем каталог бэкапов если его нет
    mkdir -p "$BACKUP_PATH"
    
    # Создаём бэкап
    if tar -czf "$BACKUP_FILE" -C "/mnt" "${DISK_NAME}"; then
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