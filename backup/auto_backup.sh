#!/bin/bash

# Скрипт для настройки системы резервного копирования на удаленном сервере

# Загружаем конфигурацию и общие функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/backup_config.sh"

# Получаем API ключ из .env файла бэкенда
BACKEND_ENV_FILE="/home/user/iqbanana_space_disk/backend/.env"
SERVER_IP=$(hostname -I | awk '{print $1}')
API_URL="http://${SERVER_IP}:6005"

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

# Извлекаем BACKUP_API_KEY из .env файла
BACKUP_API_KEY=$(grep BACKUP_API_KEY $BACKEND_ENV_FILE | cut -d'=' -f2 | tr -d '\r' | tr -d ' ' | tr -d '"' | tr -d "'")
if [ -z "$BACKUP_API_KEY" ]; then
    log "ОШИБКА: BACKUP_API_KEY не найден в файле .env"
    log "Пожалуйста, добавьте в файл .env строку BACKUP_API_KEY=ваш_ключ"
    exit 1
fi

log "Используется BACKUP_API_KEY из .env файла: $BACKUP_API_KEY"

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

# Проверка и установка необходимых зависимостей на удаленном сервере
log "Проверка и установка необходимых зависимостей на сервере $BACKUP_SERVER"

# Создаем временный скрипт для проверки и установки зависимостей
cat > /tmp/check_deps.sh << 'EOF'
#!/bin/bash

# Определяем, какой менеджер пакетов использовать
if command -v apt-get &> /dev/null; then
    PKG_MANAGER="apt-get"
    INSTALL_CMD="apt-get update && apt-get install -y"
elif command -v yum &> /dev/null; then
    PKG_MANAGER="yum"
    INSTALL_CMD="yum -y install"
elif command -v dnf &> /dev/null; then
    PKG_MANAGER="dnf"
    INSTALL_CMD="dnf -y install"
elif command -v zypper &> /dev/null; then
    PKG_MANAGER="zypper"
    INSTALL_CMD="zypper in -y"
else
    echo "Не удалось определить менеджер пакетов. Установите пакеты вручную."
    exit 1
fi

echo "Используем менеджер пакетов: $PKG_MANAGER"

# Проверка и установка пакетов
check_and_install() {
    command_name="$1"
    package_name="$2"
    
    echo "Проверка команды $command_name (пакет $package_name)..."
    
    if ! command -v "$command_name" &> /dev/null; then
        echo "Команда $command_name не найдена. Устанавливаю пакет $package_name..."
        eval "$INSTALL_CMD $package_name"
        
        if ! command -v "$command_name" &> /dev/null; then
            echo "ОШИБКА: Не удалось установить $package_name!"
            return 1
        else
            echo "Пакет $package_name успешно установлен."
        fi
    else
        echo "Команда $command_name найдена, пакет $package_name уже установлен."
    fi
    return 0
}

# Устанавливаем необходимые пакеты
echo "Установка необходимых зависимостей..."
check_and_install "curl" "curl" || exit 1
check_and_install "tar" "tar" || exit 1
check_and_install "find" "findutils" || exit 1

# Дополнительная проверка, что все команды доступны
for cmd in curl tar find; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "КРИТИЧЕСКАЯ ОШИБКА: Команда $cmd все еще недоступна после установки!"
        exit 1
    fi
done

echo "Все необходимые зависимости установлены и доступны."
exit 0
EOF

# Копируем и выполняем скрипт проверки зависимостей на удаленном сервере
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -P "$BACKUP_SERVER_PORT" /tmp/check_deps.sh root@$BACKUP_SERVER:/tmp/check_deps.sh
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "chmod +x /tmp/check_deps.sh && /tmp/check_deps.sh"

if [ $? -ne 0 ]; then
    log "Ошибка: Не удалось установить необходимые зависимости на сервере"
    exit 1
fi

# Создаем временный файл с серверным скриптом make_backup.sh
cat > /tmp/make_backup.sh << 'EOF'
#!/bin/bash

# Скрипт создания бэкапа и отправки статуса через API
# Использование: ./make_backup.sh disk_uuid backup_path api_key api_url max_backups [interval]

# Проверка аргументов
if [ $# -lt 5 ]; then
    echo "Использование: $0 disk_uuid backup_path api_key api_url max_backups [interval]"
    exit 1
fi

# Устанавливаем зависимости при необходимости
check_and_install_deps() {
    # Определяем менеджер пакетов
    if command -v apt-get &> /dev/null; then
        PKG_MANAGER="apt-get"
        INSTALL_CMD="apt-get update && apt-get install -y"
    elif command -v yum &> /dev/null; then
        PKG_MANAGER="yum"
        INSTALL_CMD="yum -y install"
    elif command -v dnf &> /dev/null; then
        PKG_MANAGER="dnf"
        INSTALL_CMD="dnf -y install"
    elif command -v zypper &> /dev/null; then
        PKG_MANAGER="zypper"
        INSTALL_CMD="zypper in -y"
    else
        echo "Не удалось определить менеджер пакетов"
        return 1
    fi
    
    echo "Используем менеджер пакетов: $PKG_MANAGER"
    
    # Проверяем и устанавливаем пакеты
    check_cmd() {
        local cmd="$1"
        local pkg="$2"
        if ! command -v "$cmd" &> /dev/null; then
            echo "Команда $cmd не найдена, устанавливаем пакет $pkg..."
            eval "$INSTALL_CMD $pkg"
            if ! command -v "$cmd" &> /dev/null; then
                echo "ОШИБКА: Не удалось установить $pkg"
                return 1
            fi
        fi
        return 0
    }
    
    # Проверяем основные команды
    check_cmd "curl" "curl" || return 1
    check_cmd "tar" "tar" || return 1
    check_cmd "find" "findutils" || return 1
    check_cmd "mountpoint" "util-linux" || return 1
    check_cmd "mkdir" "coreutils" || return 1
    check_cmd "df" "coreutils" || return 1
    check_cmd "timeout" "coreutils" || return 1
    check_cmd "pv" "pv" || echo "Утилита pv не установлена, будет использоваться простой вывод прогресса"
    check_cmd "ping" "iputils-ping" || echo "Утилита ping не установлена"
    
    echo "Все необходимые зависимости установлены"
    return 0
}

# Устанавливаем зависимости
echo "Проверка и установка необходимых зависимостей..."
if ! check_and_install_deps; then
    echo "ОШИБКА: Не удалось установить необходимые зависимости"
    exit 1
fi

DISK_UUID="$1"
BACKUP_PATH="$2"
API_KEY="$3"
API_URL="$4"
MAX_BACKUPS="${5:-5}"  # Максимальное количество бэкапов (по умолчанию 5)
INTERVAL="${6:-daily}"
TIMEOUT_MINUTES=120    # Максимальное время выполнения команды tar в минутах

# Если API_URL содержит localhost, заменяем на IP-адрес
if echo "$API_URL" | grep -q "localhost"; then
    # Извлекаем порт из URL
    PORT=$(echo "$API_URL" | sed -n 's/.*localhost:\([0-9]\+\).*/\1/p')
    if [ -n "$PORT" ]; then
        # Получаем IP-адрес сервера
        SERVER_IP=$(hostname -I | awk '{print $1}')
        if [ -n "$SERVER_IP" ]; then
            NEW_API_URL="http://${SERVER_IP}:${PORT}"
            echo "Заменяем localhost на IP адрес: $NEW_API_URL"
            API_URL="$NEW_API_URL"
        else
            echo "Не удалось определить IP-адрес сервера, используем исходный URL: $API_URL"
        fi
    fi
fi

# Получаем короткое имя диска (для имени файла и логов)
DISK_NAME=$(echo $DISK_UUID | cut -d'-' -f1)

# Путь для логов
LOG_DIR="/var/log/iqbanana_backups"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${DISK_NAME}_backup.log"

# Функция для отправки статуса через API
send_backup_status() {
    local status="$1"
    local message="$2"
    
    # Формируем JSON для отправки
    json_data="{\"diskName\":\"$DISK_UUID\",\"status\":\"$status\",\"message\":\"$message\"}"
    
    log_message "Отправка статуса '$status' в API: $message"
    log_message "URL: ${API_URL}/api/system/backup-status"
    log_message "API Key: $API_KEY"
    
    # Проверяем доступность API сервера
    if command -v ping &> /dev/null; then
        API_HOST=$(echo "$API_URL" | sed -n 's/http[s]*:\/\/\([^:]*\).*/\1/p')
        log_message "Проверка доступности API сервера ($API_HOST)..."
        if ! ping -c 1 -W 2 "$API_HOST" &> /dev/null; then
            log_message "ПРЕДУПРЕЖДЕНИЕ: Сервер API ($API_HOST) недоступен!"
        else
            log_message "Сервер API ($API_HOST) доступен"
        fi
    fi
    
    # Отправляем запрос на API с подробным выводом
    response=$(curl -v -s -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-KEY: $API_KEY" \
        -d "$json_data" \
        "${API_URL}/api/system/backup-status" 2>&1)
    
    # Проверяем ответ
    log_message "API response: $response"
    
    # Проверяем наличие ошибки соединения в ответе
    if echo "$response" | grep -q "Connection refused"; then
        log_message "ОШИБКА: Не удалось подключиться к API (отказано в соединении)"
        log_message "Пожалуйста, проверьте, что сервер запущен и доступен по адресу ${API_URL}"
    elif echo "$response" | grep -q "Couldn't connect to server"; then
        log_message "ОШИБКА: Не удалось подключиться к API (сервер недоступен)"
        log_message "Пожалуйста, проверьте, что сервер запущен и доступен по адресу ${API_URL}"
    fi
}

# Запись в лог с датой
log_message() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$message" >> "$LOG_FILE"
    echo "$message"
}

# Функция для проверки свободного места
check_free_space() {
    local path="$1"
    local required_mb="$2"
    
    # Получаем доступное место в MB
    local available_space=$(df -m --output=avail "$path" | tail -n 1 | tr -d ' ')
    
    log_message "Проверка свободного места: доступно $available_space MB, требуется примерно $required_mb MB"
    
    if [ "$available_space" -lt "$required_mb" ]; then
        log_message "ОШИБКА: Недостаточно места для создания бэкапа. Доступно: $available_space MB, требуется: $required_mb MB"
        return 1
    fi
    
    return 0
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

# Очистка старых резервных копий (оставляем только последние MAX_BACKUPS)
cleanup_old_backups() {
    # Получаем список файлов бэкапов для данного диска
    log_message "Поиск старых бэкапов..."
    backup_files=$(find "$BACKUP_PATH" -name "${DISK_NAME}_backup_*.tar.gz" | sort)
    
    # Подсчитываем количество файлов
    count=$(echo "$backup_files" | wc -l)
    log_message "Найдено $count файлов бэкапов"
    
    # Если файлов больше MAX_BACKUPS, удаляем самые старые
    if [ "$count" -gt "$MAX_BACKUPS" ]; then
        # Количество файлов для удаления
        remove_count=$((count - MAX_BACKUPS))
        
        # Получаем список файлов для удаления (самые старые)
        files_to_remove=$(echo "$backup_files" | head -n "$remove_count")
        
        # Удаляем каждый файл
        echo "$files_to_remove" | while read -r file; do
            log_message "Удаление старого бэкапа: $file"
            rm -f "$file"
        done
        
        log_message "Удалено $remove_count старых бэкапов, оставлено $MAX_BACKUPS последних"
    fi
}

# Функция для создания бэкапа
make_backup() {
    # Ищем точку монтирования диска
    DISK_MOUNTPOINT=$(find_mountpoint "$DISK_UUID")
    
    if [ -z "$DISK_MOUNTPOINT" ]; then
        log_message "ОШИБКА: Диск с UUID ${DISK_UUID} не найден или не смонтирован"
        log_message "Проверьте, что диск смонтирован по одному из путей: /mnt/$DISK_UUID, /mnt/storage/$DISK_UUID или другому пути"
        send_backup_status "ERROR" "Диск с UUID ${DISK_UUID} не найден или не смонтирован"
        return 1
    fi
    
    log_message "Найдена точка монтирования диска: $DISK_MOUNTPOINT"
    
    # Проверяем размер данных для оценки необходимого места
    log_message "Оценка размера данных..."
    local disk_size_mb=$(du -sm "$DISK_MOUNTPOINT" 2>/dev/null | awk '{print $1}')
    if [ -z "$disk_size_mb" ]; then
        log_message "Не удалось определить размер данных, используем оценку 1000 MB"
        disk_size_mb=1000
    fi
    log_message "Примерный размер данных: $disk_size_mb MB"
    
    # Добавляем 20% на сжатие (более реалистичная оценка)
    local required_space=$((disk_size_mb * 80 / 100))
    
    # Проверяем свободное место
    if ! check_free_space "$BACKUP_PATH" "$required_space"; then
        send_backup_status "ERROR" "Недостаточно места для создания бэкапа"
        return 1
    fi
    
    # Формируем имя файла бэкапа с текущей датой
    DATE_SUFFIX=$(date '+%Y%m%d_%H%M%S')
    BACKUP_FILE="${BACKUP_PATH}/${DISK_NAME}_backup_${DATE_SUFFIX}.tar.gz"
    
    # Отправляем статус о начале бэкапа
    send_backup_status "PROCESSING" "Начало резервного копирования"
    log_message "Начало создания бэкапа для диска ${DISK_UUID}"
    log_message "Настройка ротации: сохраняем $MAX_BACKUPS последних бэкапов"
    
    # Создаем каталог бэкапов если его нет
    mkdir -p "$BACKUP_PATH"
    
    # Создаём бэкап с таймаутом и подробным выводом
    log_message "Создание бэкапа из $DISK_MOUNTPOINT в $BACKUP_FILE (таймаут: $TIMEOUT_MINUTES минут)"
    
    # Определяем исходные пути
    SOURCE_DIR="$(dirname "$DISK_MOUNTPOINT")"
    SOURCE_BASE="$(basename "$DISK_MOUNTPOINT")"
    
    # Создаем дополнительный лог-файл для вывода tar
    TAR_LOG="${LOG_DIR}/${DISK_NAME}_tar_${DATE_SUFFIX}.log"
    log_message "Подробный лог архивации будет записан в $TAR_LOG"
    
    # Запускаем tar с таймаутом и подробным выводом
    log_message "Начало архивации, это может занять продолжительное время..."
    
    # Проверяем доступность pv для более наглядного прогресса
    if command -v pv &> /dev/null && command -v du &> /dev/null; then
        # Получаем размер данных в байтах для pv
        size_bytes=$(du -sb "$DISK_MOUNTPOINT" 2>/dev/null | cut -f1)
        if [ -n "$size_bytes" ] && [ "$size_bytes" -gt 0 ]; then
            log_message "Используем pv для отображения прогресса ($size_bytes bytes)"
            timeout ${TIMEOUT_MINUTES}m bash -c "tar -c -C \"$SOURCE_DIR\" \"$SOURCE_BASE\" | pv -s $size_bytes | gzip > \"$BACKUP_FILE\"" 2>&1 | tee "$TAR_LOG"
            EXIT_CODE=${PIPESTATUS[0]}
        else
            log_message "Невозможно определить размер для pv, используем обычный tar с подробным выводом"
            timeout ${TIMEOUT_MINUTES}m tar -czvf "$BACKUP_FILE" -C "$SOURCE_DIR" "$SOURCE_BASE" 2>&1 | tee "$TAR_LOG"
            EXIT_CODE=$?
        fi
    else
        log_message "Используем tar с подробным выводом (pv недоступен)"
        timeout ${TIMEOUT_MINUTES}m tar -czvf "$BACKUP_FILE" --checkpoint=100 --checkpoint-action=echo="Прогресс: %u файлов архивировано" -C "$SOURCE_DIR" "$SOURCE_BASE" 2>&1 | tee "$TAR_LOG"
        EXIT_CODE=$?
    fi
    
    if [ $EXIT_CODE -eq 0 ]; then
        log_message "Бэкап успешно создан: $BACKUP_FILE"
        log_message "Размер бэкапа: $(du -h "$BACKUP_FILE" | cut -f1)"
        
        # Очистка старых бэкапов
        cleanup_old_backups
        
        # Отправляем статус об успешном создании бэкапа
        send_backup_status "SUCCESS" "Бэкап успешно создан: $(basename "$BACKUP_FILE") ($(du -h "$BACKUP_FILE" | cut -f1))"
        return 0
    else
        if [ $EXIT_CODE -eq 124 ]; then
            log_message "ОШИБКА: Превышено время ожидания (${TIMEOUT_MINUTES} минут) при создании бэкапа"
            send_backup_status "ERROR" "Превышено время ожидания при создании бэкапа (${TIMEOUT_MINUTES} минут)"
        else
            log_message "ОШИБКА при создании бэкапа (код: $EXIT_CODE)"
            log_message "Просмотрите детальный лог в файле $TAR_LOG"
            send_backup_status "ERROR" "Ошибка при создании бэкапа (код: $EXIT_CODE)"
        fi
        
        # Удаляем неполный файл бэкапа
        if [ -f "$BACKUP_FILE" ]; then
            log_message "Удаление неполного файла бэкапа: $BACKUP_FILE"
            rm -f "$BACKUP_FILE"
        fi
        
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

if [ $# -lt 6 ]; then
    echo "Использование: $0 <script> <disk_uuid> <backup_path> <api_key> <api_url> <max_backups> <interval>"
    exit 1
fi

SCRIPT="$1"
DISK_UUID="$2"
BACKUP_PATH="$3"
API_KEY="$4"
API_URL="$5"
MAX_BACKUPS="$6"
INTERVAL="$7"

# Устанавливаем cron выражение в зависимости от интервала
case "$INTERVAL" in
    hourly)
        # Каждый час в начале часа
        CRON_EXPR="0 * * * *"
        ;;
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
CRON_LINE="$CRON_EXPR $SCRIPT $DISK_UUID $BACKUP_PATH $API_KEY $API_URL $MAX_BACKUPS $INTERVAL"

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

# Запускаем скрипт для настройки cron
log "Настройка cron задания для бэкапа диска $SOURCE_UUID"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "bash -c '/root/setup_cron.sh /root/make_backup.sh \"$SOURCE_UUID\" \"$BACKUP_PATH\" \"$BACKUP_API_KEY\" \"$API_URL\" \"$MAX_BACKUPS\" \"$BACKUP_FREQUENCY\"'"

# Запускаем бэкап немедленно, если указано
if [ "$1" == "now" ]; then
    log "Запуск немедленного резервного копирования..."
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "bash -c '/root/make_backup.sh \"$SOURCE_UUID\" \"$BACKUP_PATH\" \"$BACKUP_API_KEY\" \"$API_URL\" \"$MAX_BACKUPS\" \"$BACKUP_FREQUENCY\"'"
    
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