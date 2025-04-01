#!/bin/bash

# Подключаем функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "${SCRIPT_DIR}/backup_functions.sh"

# Инициализация лог-файла
touch "$LOG_FILE"
echo "=========================================" >> "$LOG_FILE"
echo "Запуск настройки бэкапов $(date)" >> "$LOG_FILE"
echo "=========================================" >> "$LOG_FILE"

# Загружаем конфигурацию
load_config

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

# Создаем скрипт бэкапа
cat > /tmp/backup_runner.sh << 'EOF'
#!/bin/bash

# Переменные окружения
export BORG_PASSPHRASE="###BORG_PASSPHRASE###"
SOURCE_DISK="###SOURCE_DISK###"
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

log_error() {
    log_message "ERROR" "$1"
}

log_progress() {
    local percent=$1
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    echo "[$timestamp] [PROGRESS] $percent% выполнено" >> "$LOG_FILE"
}

# Функция для получения размера диска в байтах
get_disk_size() {
    blockdev --getsize64 "/dev/$SOURCE_DISK"
}

# Функция для создания бэкапа
create_backup() {
    local backup_name="$(date +%Y-%m-%d_%H-%M-%S)"
    log_info "Создание бэкапа диска /dev/$SOURCE_DISK с именем $backup_name"
    
    # Записываем стартовую метку прогресса
    log_progress "0"
    
    # Получаем размер диска
    local disk_size=$(get_disk_size)
    
    # Создаем бэкап диска с отслеживанием прогресса
    # Используем pv для отображения прогресса
    if command -v pv >/dev/null 2>&1; then
        # Вариант с pv (показывает прогресс)
        log_info "Запуск бэкапа с мониторингом прогресса"
        
        (
            # Запускаем в фоне процесс мониторинга для обновления прогресса
            (
                while ps -p $$ >/dev/null 2>&1; do
                    if [ -e "/tmp/backup_progress" ]; then
                        percent=$(cat /tmp/backup_progress)
                        log_progress "$percent"
                    fi
                    sleep 10
                done
            ) &
            
            # Запускаем процесс бэкапа с pv для отслеживания прогресса
            dd if=/dev/$SOURCE_DISK bs=1M status=none | \
            pv -n -s $disk_size | \
            tee >(echo "0" > /tmp/backup_progress; awk -v size=$disk_size 'BEGIN {getline; bytes=$1} {printf "%d\n", (bytes/size)*100 > "/tmp/backup_progress"}') | \
            borg create --read-special $REPO_PATH::$backup_name -
            
            # Удаляем временный файл прогресса
            rm -f /tmp/backup_progress
            
            # Явно убиваем фоновый процесс мониторинга
            pkill -P $$
            
            return ${PIPESTATUS[2]}
        )
    else
        # Запасной вариант без pv, просто используем --progress
        log_info "Утилита pv не найдена, используем встроенный индикатор прогресса"
        
        # Создаем бэкап с встроенным прогрессом Borg
        if ! borg create --verbose --stats --progress --read-special "$REPO_PATH::$backup_name" "/dev/$SOURCE_DISK"; then
            log_error "Не удалось создать бэкап диска /dev/$SOURCE_DISK"
            return 1
        fi
    fi
    
    # Записываем финальную метку прогресса
    log_progress "100"
    log_info "Бэкап диска /dev/$SOURCE_DISK успешно создан с именем $backup_name"
    
    # Очистка старых бэкапов
    prune_old_backups
    
    return 0
}

# Функция для удаления старых бэкапов
prune_old_backups() {
    log_info "Очистка старых бэкапов"
    
    # Удаляем старые бэкапы, оставляя только MAX_BACKUPS последних
    if ! borg prune --keep-last=$MAX_BACKUPS --verbose "$REPO_PATH"; then
        log_error "Не удалось очистить старые бэкапы"
        return 1
    fi
    
    log_info "Старые бэкапы успешно очищены, оставлено последних $MAX_BACKUPS"
    return 0
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
sed -i "s|###BORG_PASSPHRASE###|$BORG_PASSPHRASE|g" /tmp/backup_runner.sh
sed -i "s|###SOURCE_DISK###|$SOURCE_DISK|g" /tmp/backup_runner.sh
sed -i "s|###REPO_PATH###|$REPO_PATH|g" /tmp/backup_runner.sh
sed -i "s|###MAX_BACKUPS###|$MAX_BACKUPS|g" /tmp/backup_runner.sh
sed -i "s|###LOG_FILE###|/root/backup.log|g" /tmp/backup_runner.sh

# Копируем скрипт на сервер
scp -P "$server_port" /tmp/backup_runner.sh "root@$SSH_HOST:$REMOTE_SCRIPT_PATH"
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