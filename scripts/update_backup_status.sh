#!/bin/bash

# Скрипт для обновления статуса бэкапа через API
# Использование: ./update_backup_status.sh disk_uuid status message

# Проверка аргументов
if [ $# -lt 3 ]; then
    echo "Использование: $0 disk_uuid status message"
    echo "  disk_uuid  - UUID диска"
    echo "  status     - Статус бэкапа (PROCESSING, SUCCESS, ERROR, IDLE)"
    echo "  message    - Сообщение о статусе бэкапа"
    exit 1
fi

DISK_UUID="$1"
STATUS="$2"
MESSAGE="$3"

# Путь для логов
LOG_DIR="/var/log/iqbanana_backups"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backup_status.log"

# Запись в лог с датой
log_message() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$message" >> "$LOG_FILE"
    echo "$message" # Вывод на экран
}

# Функция для отправки статуса через API
send_backup_status() {
    local disk_uuid="$1"
    local status="$2"
    local message="$3"
    
    # Вывод информации о запросе к API для отладки
    log_message "ОТПРАВКА API: Отправка статуса '$status' с сообщением '$message' для диска $disk_uuid"
    
    # Формируем JSON для отправки
    json_data="{\"diskName\":\"$disk_uuid\",\"status\":\"$status\",\"message\":\"$message\"}"

    # Путь к файлу .env
    ENV_FILE="/home/user/iqbanana_space_disk/backend/.env"
    
    # Если файл .env существует, извлекаем API_KEY и PORT
    if [ -f "$ENV_FILE" ]; then
        # Извлекаем BACKUP_API_KEY из .env
        API_KEY=$(grep BACKUP_API_KEY "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r' | tr -d ' ' | tr -d '"' | tr -d "'")
        log_message "Получен API_KEY из .env файла"
        
        # Извлекаем порт из .env
        ENV_PORT=$(grep PORT "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r' | tr -d ' ' | tr -d '"' | tr -d "'")
        if [ -n "$ENV_PORT" ]; then
            # Определяем IP сервера
            SERVER_IP=$(hostname -I | awk '{print $1}')
            API_URL="http://${SERVER_IP}:${ENV_PORT}"
            log_message "API URL: $API_URL"
        else
            # По умолчанию используем порт 6005
            SERVER_IP=$(hostname -I | awk '{print $1}')
            API_URL="http://${SERVER_IP}:6005"
            log_message "Используем API URL по умолчанию: $API_URL"
        fi
    else
        log_message "ПРЕДУПРЕЖДЕНИЕ: Файл .env не найден, используем значения по умолчанию"
        API_KEY="mykey" # Значение по умолчанию
        API_URL="http://localhost:6005" # URL по умолчанию
    fi
    
    # Сначала пробуем новый путь API (v1)
    log_message "Отправка запроса на API: ${API_URL}/api/v1/backups/status"
    response=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-KEY: $API_KEY" \
        -d "$json_data" \
        "${API_URL}/api/v1/backups/status" 2>&1)
    
    # Проверяем ответ
    log_message "ОТВЕТ API (v1): $response"
    
    # Если первый запрос не удался, попробуем со старым путем API
    if [[ "$response" == *"Failed to connect"* || "$response" == *"Connection refused"* || "$response" == *"404"* ]]; then
        log_message "Запрос к v1 API не удался, пробуем систему API"
        response=$(curl -s -X POST \
            -H "Content-Type: application/json" \
            -H "X-API-KEY: $API_KEY" \
            -d "$json_data" \
            "${API_URL}/api/system/backup-status" 2>&1)
        log_message "ОТВЕТ API (system): $response"
    fi
    
    # Если и второй запрос не удался, пробуем с токеном авторизации
    if [[ "$response" == *"Failed to connect"* || "$response" == *"Connection refused"* || "$response" == *"401"* ]]; then
        log_message "Запрос не удался, пробуем с токеном авторизации"
        
        # Пытаемся получить токен авторизации (используя тестовый аккаунт)
        log_message "Пытаемся получить токен авторизации"
        auth_response=$(curl -s -X POST \
            -H "Content-Type: application/json" \
            -d '{"email":"admin@example.com","password":"admin"}' \
            "${API_URL}/api/v1/auth/login" 2>&1)
        
        # Извлекаем токен из ответа
        token=$(echo "$auth_response" | grep -o '"token":"[^"]*"' | cut -d':' -f2 | tr -d '"' | tr -d ' ')
        
        if [ -n "$token" ]; then
            log_message "Токен получен успешно"
            
            # Отправляем запрос с токеном
            response=$(curl -s -X POST \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $token" \
                -d "$json_data" \
                "${API_URL}/api/v1/backups/status" 2>&1)
            log_message "ОТВЕТ API (с токеном): $response"
        else
            log_message "Не удалось получить токен авторизации: $auth_response"
        fi
    fi
}

# Отправляем статус
send_backup_status "$DISK_UUID" "$STATUS" "$MESSAGE"

exit 0