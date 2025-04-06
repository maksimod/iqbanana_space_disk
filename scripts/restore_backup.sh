#!/bin/bash

# Скрипт восстановления из бэкапа и отправки статуса через API
# Использование: ./restore_backup.sh backup_file mount_point disk_uuid

# Проверка аргументов
if [ $# -lt 3 ]; then
    echo "Использование: $0 backup_file mount_point disk_uuid"
    echo "  backup_file  - Полный путь к файлу бэкапа"
    echo "  mount_point  - Точка монтирования диска для восстановления"
    echo "  disk_uuid    - UUID диска для обновления статуса"
    exit 1
fi

BACKUP_FILE="$1"
MOUNT_POINT="$2"
DISK_UUID="$3"

# Путь для логов
LOG_DIR="/var/log/iqbanana_backups"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${DISK_UUID}_restore.log"

# Запись в лог с датой
log_message() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$message" >> "$LOG_FILE"
    echo "$message" # Вывод на экран
}

# Функция для отправки статуса через API
send_backup_status() {
    local status="$1"
    local message="$2"
    
    # Вывод информации о запросе к API для отладки
    log_message "ОТПРАВКА API: Отправка статуса '$status' с сообщением '$message'"
    
    # Формируем JSON для отправки
    json_data="{\"diskName\":\"$DISK_UUID\",\"status\":\"$status\",\"message\":\"$message\"}"
    
    # API ключ и URL сервера
    API_KEY="mykey" # Замените на ваш API ключ
    API_URL="http://localhost:6005" # Замените на URL вашего сервера
    
    # Отправляем запрос на API
    response=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-KEY: $API_KEY" \
        -d "$json_data" \
        "${API_URL}/api/system/backup-status" 2>&1)
    
    # Проверяем ответ
    log_message "ОТВЕТ API: $response"
}

# Начинаем процесс восстановления
log_message "Начинаем восстановление из бэкапа: $BACKUP_FILE"
log_message "Точка монтирования: $MOUNT_POINT"
log_message "UUID диска: $DISK_UUID"

# Отправляем статус: в процессе
send_backup_status "PROCESSING" "Начало восстановления из бэкапа"

# Проверяем существование файла бэкапа
if [ ! -f "$BACKUP_FILE" ]; then
    log_message "ОШИБКА: Файл бэкапа не существует: $BACKUP_FILE"
    send_backup_status "ERROR" "Файл бэкапа не найден: $BACKUP_FILE"
    exit 1
fi

# Проверяем существование точки монтирования
if [ ! -d "$MOUNT_POINT" ]; then
    log_message "ОШИБКА: Точка монтирования не существует: $MOUNT_POINT"
    send_backup_status "ERROR" "Точка монтирования не найдена: $MOUNT_POINT"
    exit 1
fi

# Проверяем, смонтирован ли диск
if ! mountpoint -q "$MOUNT_POINT"; then
    log_message "ОШИБКА: Диск не смонтирован: $MOUNT_POINT"
    send_backup_status "ERROR" "Диск не смонтирован: $MOUNT_POINT"
    exit 1
fi

# Обновляем статус
send_backup_status "PROCESSING" "Подготовка к восстановлению"

# Создаем временную директорию для восстановления
TEMP_DIR=$(mktemp -d)
log_message "Создана временная директория: $TEMP_DIR"

# Обновляем статус
send_backup_status "PROCESSING" "Распаковка архива"

# Распаковываем архив во временную директорию
log_message "Распаковка архива: $BACKUP_FILE"
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR" || {
    log_message "ОШИБКА: Не удалось распаковать архив"
    send_backup_status "ERROR" "Не удалось распаковать архив"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Обновляем статус
send_backup_status "PROCESSING" "Создание резервной копии текущих данных"

# Создаем резервную копию текущих данных
BACKUP_TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
CURRENT_BACKUP_DIR="${MOUNT_POINT}_backup_${BACKUP_TIMESTAMP}"
log_message "Создание резервной копии текущих данных: $CURRENT_BACKUP_DIR"

mkdir -p "$CURRENT_BACKUP_DIR" || {
    log_message "ОШИБКА: Не удалось создать директорию для резервной копии: $CURRENT_BACKUP_DIR"
    send_backup_status "ERROR" "Не удалось создать директорию для резервной копии"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Перемещаем все текущие файлы (кроме системных) в резервную директорию
log_message "Перемещение текущих файлов в резервную директорию"
find "$MOUNT_POINT" -mindepth 1 -not -path "$MOUNT_POINT/.*" -not -path "$MOUNT_POINT/lost+found" -exec mv {} "$CURRENT_BACKUP_DIR/" \; || {
    log_message "ПРЕДУПРЕЖДЕНИЕ: Возникли проблемы при перемещении некоторых файлов"
    send_backup_status "PROCESSING" "Предупреждение: возникли проблемы при резервном копировании текущих данных"
}

# Обновляем статус
send_backup_status "PROCESSING" "Восстановление данных из бэкапа"

# Копируем файлы из временной директории в точку монтирования
log_message "Копирование файлов из бэкапа в точку монтирования"
find "$TEMP_DIR" -mindepth 1 -not -path "$TEMP_DIR/lost+found" -not -path "$TEMP_DIR/.*" -exec cp -a {} "$MOUNT_POINT/" \; || {
    log_message "ОШИБКА: Не удалось скопировать файлы из бэкапа"
    send_backup_status "ERROR" "Не удалось восстановить файлы из бэкапа"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Очистка
log_message "Удаление временной директории"
rm -rf "$TEMP_DIR"

# Проверяем результат
if [ $? -eq 0 ]; then
    log_message "Восстановление успешно завершено"
    send_backup_status "SUCCESS" "Восстановление успешно завершено. Резервная копия текущих данных: $CURRENT_BACKUP_DIR"
else
    log_message "ОШИБКА: Произошла ошибка при восстановлении"
    send_backup_status "ERROR" "Произошла ошибка при восстановлении"
fi

log_message "Процесс восстановления завершен"
exit 0 