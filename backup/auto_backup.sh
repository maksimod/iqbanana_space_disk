#!/bin/bash

# Скрипт для настройки системы резервного копирования на удаленном сервере

# Загружаем конфигурацию и общие функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/backup_config.sh"

# Получаем API ключ из .env файла бэкенда
BACKEND_ENV_FILE="/home/user/iqbanana_space_disk/backend/.env"
API_URL="http://localhost:6005"

# Функция для записи в лог
log() {
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1"
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1" >> "$LOG_FILE"
}

# Проверяем наличие .env файла
if [ ! -f "$BACKEND_ENV_FILE" ]; then
    log "ОШИБКА: Файл .env не найден по пути $BACKEND_ENV_FILE"
    exit 1
fi

# Извлекаем API_KEY из .env файла
API_KEY=$(grep API_KEY $BACKEND_ENV_FILE | cut -d'=' -f2 | tr -d '\r' | tr -d ' ' | tr -d '"' | tr -d "'")
if [ -z "$API_KEY" ]; then
    log "ОШИБКА: API_KEY не найден в файле .env"
    exit 1
fi

# Получаем порт из .env, если есть
ENV_PORT=$(grep PORT $BACKEND_ENV_FILE | cut -d'=' -f2 | tr -d '\r')
if [ -n "$ENV_PORT" ]; then
    API_URL="http://localhost:$ENV_PORT"
fi

# Проверка наличия ключа SSH
if [ ! -f "$SSH_KEY_PATH" ]; then
    log "Ошибка: SSH ключ $SSH_KEY_PATH не найден."
    log "Пожалуйста, запустите скрипт set_ssh.sh для настройки SSH соединения."
    exit 1
fi

# Проверка подключения к серверу
log "Проверка подключения к серверу $BACKUP_SERVER через порт $BACKUP_SERVER_PORT"
if ! ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -p "$BACKUP_SERVER_PORT" "root@$BACKUP_SERVER" "echo 'Подключение работает'"; then
    log "Ошибка: Не удалось подключиться к серверу $BACKUP_SERVER"
    exit 1
fi

# Создаем временный файл с серверным скриптом make_backup.sh
cat > /tmp/make_backup.sh << 'EOF'
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
EOF

# Создаем скрипт cron-установщик, который будет называться setup_cron.sh
cat > /tmp/setup_cron.sh << 'EOF'
#!/bin/bash

# Удаляем существующие задания, содержащие make_backup.sh
# Создаем новое задание с правильными параметрами

if [ $# -lt 5 ]; then
    echo "Использование: $0 <script> <disk_name> <backup_path> <api_key> <api_url> <interval>"
    exit 1
fi

SCRIPT="$1"
DISK_NAME="$2"
BACKUP_PATH="$3"
API_KEY="$4"
API_URL="$5"
INTERVAL="$6"

# Устанавливаем cron выражение в зависимости от интервала
case "$INTERVAL" in
    daily)
        # Ежедневно в 2:00
        CRON_EXPR="0 2 * * *"
        ;;
    weekly)
        # Еженедельно в воскресенье в 3:00
        CRON_EXPR="0 3 * * 0"
        ;;
    monthly)
        # Ежемесячно 1-го числа в 4:00
        CRON_EXPR="0 4 1 * *"
        ;;
    *)
        echo "Неизвестный интервал: $INTERVAL. Используем ежедневный бэкап."
        CRON_EXPR="0 2 * * *"
        ;;
esac

# Генерируем строку для crontab, экранируя специальные символы
CRON_LINE="$CRON_EXPR $SCRIPT $DISK_NAME $BACKUP_PATH $API_KEY $API_URL $INTERVAL"

# Создаем файл, в который запишем текущий crontab и добавим нашу строку
TMP_FILE=$(mktemp)

# Получаем текущий crontab, исключая строки с нашим скриптом
crontab -l 2>/dev/null | grep -v "$SCRIPT" > "$TMP_FILE" || true

# Добавляем новую строку
echo "$CRON_LINE" >> "$TMP_FILE"

# Устанавливаем crontab из файла
crontab "$TMP_FILE"

# Удаляем временный файл
rm -f "$TMP_FILE"

# Проверяем, добавилось ли задание
CURRENT_CRONTAB=$(crontab -l 2>/dev/null)
if echo "$CURRENT_CRONTAB" | grep -q "$SCRIPT"; then
    echo "Crontab успешно обновлен!"
    echo "Текущие задания:"
    echo "$CURRENT_CRONTAB"
    exit 0
else
    echo "Ошибка: задание не было добавлено"
    exit 1
fi
EOF

# Копируем скрипты на сервер
log "Копирование скриптов на сервер $BACKUP_SERVER"
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -P "$BACKUP_SERVER_PORT" /tmp/make_backup.sh root@$BACKUP_SERVER:/root/make_backup.sh
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -P "$BACKUP_SERVER_PORT" /tmp/setup_cron.sh root@$BACKUP_SERVER:/root/setup_cron.sh

# Устанавливаем права на выполнение скриптов
log "Установка прав на выполнение скриптов"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "chmod +x /root/make_backup.sh /root/setup_cron.sh"

# Получаем имя диска (первая часть UUID) и путь для бэкапа
DISK_NAME=$(echo $SOURCE_UUID | cut -d'-' -f1)
BACKUP_PATH="/mnt/backup_${TARGET_UUID}"

# Запускаем скрипт для настройки cron
log "Настройка cron задания для бэкапа диска $DISK_NAME"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "bash -c '/root/setup_cron.sh /root/make_backup.sh \"$DISK_NAME\" \"$BACKUP_PATH\" \"$API_KEY\" \"$API_URL\" \"$BACKUP_FREQUENCY\"'"

# Запускаем бэкап немедленно, если указано
if [ "$1" == "now" ]; then
    log "Запуск немедленного резервного копирования..."
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "bash -c '/root/make_backup.sh \"$DISK_NAME\" \"$BACKUP_PATH\" \"$API_KEY\" \"$API_URL\" \"$BACKUP_FREQUENCY\"'"
    
    # Проверяем статус выполнения
    if [ $? -eq 0 ]; then
        log "Резервное копирование успешно выполнено"
    else
        log "Ошибка при выполнении резервного копирования"
    fi
fi

# Остальная часть скрипта без изменений
log "Настройка резервного копирования завершена."
exit 0 