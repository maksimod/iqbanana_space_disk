#!/bin/bash

# Подключаем функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "${SCRIPT_DIR}/backup_functions.sh"

# Сначала загружаем конфигурацию
load_config

# Только после загрузки конфигурации используем переменные из нее
# Инициализация лог-файла
touch "$LOG_FILE"
echo "=========================================" >> "$LOG_FILE"
echo "Запуск настройки бэкапов $(date)" >> "$LOG_FILE"
echo "=========================================" >> "$LOG_FILE"

# Проверяем доступность сервера
for port_entry in "${SSH_PORTS[@]}"; do
    server=$(echo $port_entry | cut -d':' -f1)
    port=$(echo $port_entry | cut -d':' -f2)
    
    if [[ "$server" == "$BACKUP_SERVER" ]]; then
        server_port=$port
        break
    fi
done

if [ -z "$server_port" ]; then
    log_error "Не найден порт для сервера $BACKUP_SERVER в SSH_PORTS"
    exit 1
fi

# Проверяем доступность сервера
if ! check_server "$BACKUP_SERVER" "$server_port"; then
    log_error "Сервер $BACKUP_SERVER недоступен"
    exit 1
fi

log_info "Сервер $BACKUP_SERVER доступен. Начинаем настройку бэкапа."

# Устанавливаем Borg Backup
if ! install_borg "$BACKUP_SERVER" "$server_port"; then
    log_error "Не удалось установить Borg Backup на сервере $BACKUP_SERVER"
    exit 1
fi

# Устанавливаем pv для отображения прогресса
remote_exec "$BACKUP_SERVER" "$server_port" "which pv > /dev/null || apt-get -y install pv"

# Подготавливаем диск назначения
if ! prepare_target_disk "$BACKUP_SERVER" "$server_port" "$TARGET_DISK" "$TARGET_MOUNT"; then
    log_error "Не удалось подготовить диск назначения $TARGET_DISK"
    exit 1
fi

# Определяем путь для репозитория Borg
REPO_PATH="${TARGET_MOUNT}/${REPO_NAME}"

# Инициализируем репозиторий Borg
if ! init_borg_repo "$BACKUP_SERVER" "$server_port" "$REPO_PATH"; then
    log_error "Не удалось инициализировать репозиторий Borg"
    exit 1
fi

# Копируем скрипт бэкапа на целевой сервер
REMOTE_SCRIPT_PATH="/root/backup_runner.sh"
log_info "Создание скрипта запуска бэкапа на сервере $BACKUP_SERVER"

# Получаем UUID исходного диска
log_info "Получение UUID диска /dev/$SOURCE_DISK на сервере $BACKUP_SERVER..."
# Запускаем команду и очищаем вывод от любых лишних данных
SOURCE_UUID_OUTPUT=$(remote_exec "$BACKUP_SERVER" "$server_port" "blkid -s UUID -o value /dev/$SOURCE_DISK")

# Извлекаем UUID из вывода - берем ТОЛЬКО ПЕРВОЕ совпадение шаблона
SOURCE_UUID=$(echo "$SOURCE_UUID_OUTPUT" | grep -o -E '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1)

if [ -z "$SOURCE_UUID" ]; then
    log_error "Не удалось получить UUID для диска /dev/$SOURCE_DISK"
    exit 1
fi

# Очищаем от любых возможных пробелов и переносов строк
SOURCE_UUID=$(echo "$SOURCE_UUID" | tr -d '[:space:]')

log_info "UUID источника: $SOURCE_UUID"

# Создаем скрипт бэкапа
cat > /tmp/backup_runner.sh << 'EOF'
#!/bin/bash

# Переменные окружения
export BORG_PASSPHRASE="###BORG_PASSPHRASE###"
SOURCE_UUID="###SOURCE_UUID###"
SOURCE_DISK="###SOURCE_DISK###"  # Оставляем для обратной совместимости
REPO_PATH="###REPO_PATH###"
MAX_BACKUPS=###MAX_BACKUPS###
LOG_FILE="###LOG_FILE###"

# Файл блокировки для предотвращения одновременного запуска
LOCK_FILE="/tmp/borg_backup.lock"

# Получаем текущее время для логирования
timestamp=$(date "+%Y-%m-%d %H:%M:%S")

# Проверяем, выполняется ли уже другой процесс бэкапа
if [ -e "$LOCK_FILE" ]; then
    # Получаем PID предыдущего процесса
    LOCK_PID=$(cat "$LOCK_FILE")

    # Проверяем, активен ли еще процесс
    if ps -p $LOCK_PID > /dev/null; then
        echo "[$timestamp] [WARNING] Предыдущий процесс бэкапа (PID: $LOCK_PID) еще выполняется. Выход."
        echo "[$timestamp] [WARNING] Предыдущий процесс бэкапа (PID: $LOCK_PID) еще выполняется. Выход." >> "$LOG_FILE"
        exit 0
    else
        # Удаляем устаревший файл блокировки
        rm -f "$LOCK_FILE"
    fi
fi

# Создаем файл блокировки
echo $$ > "$LOCK_FILE"

# Функции для логирования
log_message() {
    local level=$1
    local message=$2
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")

    echo "[$timestamp] [$level] $message"
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
}

log_info() {
    log_message "INFO" "$1"
}

log_warning() {
    log_message "WARNING" "$1"
}

log_error() {
    log_message "ERROR" "$1"
}

# Функция для поиска точки монтирования по UUID
find_mount_point() {
    local uuid=$1
    local mount_point=$(findmnt -n -o TARGET --source UUID="$uuid" 2>/dev/null)
    echo "$mount_point"
}

# Функция для проверки и восстановления блокировки репозитория Borg
check_and_fix_borg_lock() {
    # Проверяем наличие блокировки в репозитории
    if [ -f "$REPO_PATH/lock.roster" ] || [ -d "$REPO_PATH/lock" ]; then
        log_warning "Обнаружена активная блокировка репозитория Borg. Попытка восстановления..."
        
        # Сначала пытаемся мягко снять блокировку
        if borg break-lock "$REPO_PATH"; then
            log_info "Блокировка репозитория успешно снята."
            return 0
        else
            log_error "Не удалось снять блокировку репозитория с помощью borg break-lock."
            
            # Если borg break-lock не помогает, принудительно удаляем файлы блокировки
            log_warning "Принудительное удаление файлов блокировки..."
            rm -f "$REPO_PATH/lock.roster" 2>/dev/null
            rm -rf "$REPO_PATH/lock" 2>/dev/null
            
            # Проверяем, удалось ли удалить блокировку
            if [ ! -f "$REPO_PATH/lock.roster" ] && [ ! -d "$REPO_PATH/lock" ]; then
                log_info "Файлы блокировки репозитория успешно удалены."
                return 0
            else
                log_error "Не удалось удалить файлы блокировки репозитория."
                return 1
            fi
        fi
    else
        # Блокировки нет, всё в порядке
        return 0
    fi
}

# Функция для создания бэкапа
create_backup() {
    local backup_name="$(date +%Y-%m-%d_%H-%M-%S)"
    
    # Пробуем оба метода: по UUID и по имени устройства
    local mount_point=""
    local device_path=""
    
    # 1. Проверяем точку монтирования по UUID
    if [ -n "$SOURCE_UUID" ]; then
        mount_point=$(find_mount_point "$SOURCE_UUID")
        if [ -n "$mount_point" ]; then
            log_info "Найдена точка монтирования по UUID $SOURCE_UUID: $mount_point"
        else
            log_warning "Точка монтирования по UUID $SOURCE_UUID не найдена"
        fi
    fi
    
    # 2. Проверяем существование устройства
    if [ -e "/dev/$SOURCE_DISK" ]; then
        device_path="/dev/$SOURCE_DISK"
        log_info "Устройство $device_path существует"
    else
        log_warning "Устройство /dev/$SOURCE_DISK не существует"
    fi
    
    # Проверяем и восстанавливаем блокировку репозитория
    if ! check_and_fix_borg_lock; then
        log_error "Не удалось восстановить блокировку репозитория. Бэкап не может быть выполнен."
        return 1
    fi
    
    # Экспортируем переменные среды для Borg
    export BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK=yes
    export BORG_RELOCATED_REPO_ACCESS_IS_OK=yes
    
    # Решаем, какой метод использовать для бэкапа
    if [ -n "$mount_point" ]; then
        # Бэкап файловой системы, если она смонтирована
        log_info "Создание бэкапа файловой системы $mount_point с именем $backup_name"
        
        # Проверяем, что точка монтирования доступна
        if ! [ -d "$mount_point" ] || ! [ -r "$mount_point" ]; then
            log_error "Точка монтирования $mount_point недоступна или нет прав на чтение"
            return 1
        fi
        
        # Записываем стартовую метку прогресса
        log_progress "0"
        
        # Создаем бэкап файловой системы с увеличенным тайм-аутом и добавлением опции --lock-wait
        if ! borg create --verbose --stats --progress --exclude-caches --lock-wait 60 "$REPO_PATH::$backup_name" "$mount_point"; then
            log_error "Не удалось создать бэкап файловой системы $mount_point"
            return 1
        fi
    elif [ -n "$device_path" ]; then
        # Бэкап устройства, если оно существует
        log_info "Создание бэкапа устройства $device_path с именем $backup_name"
        
        # Записываем стартовую метку прогресса
        log_progress "0"
        
        # Создаем бэкап устройства с увеличенным тайм-аутом и добавлением опции --lock-wait
        if ! borg create --verbose --stats --progress --read-special --lock-wait 60 "$REPO_PATH::$backup_name" "$device_path"; then
            log_error "Не удалось создать бэкап устройства $device_path"
            return 1
        fi
    else
        log_error "Ни точка монтирования по UUID $SOURCE_UUID, ни устройство /dev/$SOURCE_DISK не найдены"
        return 1
    fi
    
    # Записываем финальную метку прогресса
    log_progress "100"
    log_info "Бэкап успешно создан с именем $backup_name"
    
    # Очистка старых бэкапов
    prune_old_backups
    
    return 0
}

# Функция для удаления старых бэкапов
prune_old_backups() {
    log_info "Очистка старых бэкапов"
    
    # Удаляем старые бэкапы, оставляя только MAX_BACKUPS последних
    if ! borg prune --keep-last=$MAX_BACKUPS --verbose --lock-wait 60 "$REPO_PATH"; then
        log_error "Не удалось очистить старые бэкапы"
        return 1
    fi
    
    log_info "Старые бэкапы успешно очищены, оставлено последних $MAX_BACKUPS"
    return 0
}

# Функция для отображения прогресса
log_progress() {
    local percent=$1
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    echo "[$timestamp] [PROGRESS] $percent% выполнено" >> "$LOG_FILE"
}

# Записываем начало выполнения в лог
echo "=========================================" >> "$LOG_FILE"
echo "Запуск бэкапа $(date)" >> "$LOG_FILE"
echo "=========================================" >> "$LOG_FILE"

# Создаем бэкап
create_backup

# Удаляем файл блокировки
rm -f "$LOCK_FILE"
EOF

# Заменяем переменные в скрипте
log_info "Заменяем переменные в скрипте бэкапа..."
log_info "UUID диска: $SOURCE_UUID"

# Прямые замены для всех переменных кроме UUID
sed -i "s|###BORG_PASSPHRASE###|${BORG_PASSPHRASE}|g" /tmp/backup_runner.sh
sed -i "s|###SOURCE_DISK###|${SOURCE_DISK}|g" /tmp/backup_runner.sh
sed -i "s|###REPO_PATH###|${REPO_PATH}|g" /tmp/backup_runner.sh
sed -i "s|###MAX_BACKUPS###|${MAX_BACKUPS}|g" /tmp/backup_runner.sh
sed -i "s|###LOG_FILE###|/root/backup.log|g" /tmp/backup_runner.sh

# Специальная замена для UUID - используем точную замену всей строки
sed -i "s|SOURCE_UUID=\"###SOURCE_UUID###\"|SOURCE_UUID=\"${SOURCE_UUID}\"|g" /tmp/backup_runner.sh

# Проверяем, что все плейсхолдеры были заменены
if grep -q "###" /tmp/backup_runner.sh; then
    log_error "Некоторые плейсхолдеры не были заменены в скрипте:"
    grep "###" /tmp/backup_runner.sh
    exit 1
fi

# Проверяем содержимое скрипта
log_info "Проверка содержимого скрипта бэкапа:"
grep "SOURCE_UUID" /tmp/backup_runner.sh

# Копируем скрипт на сервер
if ! remote_exec "$BACKUP_SERVER" "$server_port" "cat > $REMOTE_SCRIPT_PATH" < /tmp/backup_runner.sh; then
    log_error "Не удалось скопировать скрипт бэкапа на сервер"
    rm -f /tmp/backup_runner.sh
    exit 1
fi

remote_exec "$BACKUP_SERVER" "$server_port" "chmod +x $REMOTE_SCRIPT_PATH"

# Удаляем временный файл
rm -f /tmp/backup_runner.sh

# Настраиваем автоматические бэкапы
if ! setup_automatic_backups "$BACKUP_SERVER" "$server_port" "$REMOTE_SCRIPT_PATH" "$BACKUP_FREQUENCY"; then
    log_error "Не удалось настроить автоматические бэкапы"
    exit 1
fi

log_info "Настройка бэкапов успешно завершена!"
log_info "Диск /dev/$SOURCE_DISK будет автоматически бэкапироваться с частотой: $BACKUP_FREQUENCY"
log_info "Бэкапы будут храниться на диске /dev/$TARGET_DISK в репозитории $REPO_PATH"
log_info "Будет храниться не более $MAX_BACKUPS последних бэкапов" 