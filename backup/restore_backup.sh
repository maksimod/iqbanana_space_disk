#!/bin/bash

# Подключаем функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "${SCRIPT_DIR}/backup_functions.sh"

# Сначала загружаем конфигурацию
load_config

# Проверяем аргументы
if [ $# -eq 1 ]; then
    # Пользователь указал имя бэкапа
    BACKUP_NAME="$1"
fi

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

log_info "Сервер $BACKUP_SERVER доступен."

# Устанавливаем pv для отображения прогресса, если его нет
remote_exec "$BACKUP_SERVER" "$server_port" "which pv > /dev/null || apt-get -y install pv"

# Определяем путь для репозитория Borg
REPO_PATH="${TARGET_MOUNT}/${REPO_NAME}"

# Получаем список бэкапов, если имя не указано
if [ -z "$BACKUP_NAME" ]; then
    log_info "Получение списка доступных бэкапов..."
    
    # Получаем список бэкапов
    BACKUPS=$(remote_exec "$BACKUP_SERVER" "$server_port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg list $REPO_PATH")
    
    if [ -z "$BACKUPS" ]; then
        log_error "Не найдено ни одного бэкапа в репозитории $REPO_PATH"
        exit 1
    fi
    
    # Выводим список бэкапов
    echo "Доступные бэкапы:"
    echo "$BACKUPS"
    echo ""
    
    # Запрашиваем у пользователя, какой бэкап восстановить
    echo -n "Введите имя бэкапа для восстановления: "
    read BACKUP_NAME
    
    if [ -z "$BACKUP_NAME" ]; then
        log_error "Не указано имя бэкапа для восстановления"
        exit 1
    fi
fi

# Проверяем существование бэкапа
if ! remote_exec "$BACKUP_SERVER" "$server_port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg list $REPO_PATH::$BACKUP_NAME" &>/dev/null; then
    log_error "Бэкап $BACKUP_NAME не существует в репозитории $REPO_PATH"
    exit 1
fi

# Запрашиваем подтверждение
echo ""
echo "ВНИМАНИЕ! Восстановление полностью перезапишет содержимое диска /dev/$SOURCE_DISK!"
echo "Все данные на диске будут потеряны и заменены данными из бэкапа $BACKUP_NAME."
echo ""
echo -n "Вы уверены, что хотите продолжить? (y/n): "
read CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    log_info "Восстановление отменено пользователем"
    exit 0
fi

# Функция для отображения прогресса
log_progress() {
    local percent=$1
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    echo "[$timestamp] [PROGRESS] $percent% выполнено" | tee -a "$LOG_FILE"
}

# Получаем размер диска
get_backup_info() {
    local backup_name=$1
    local info=$(remote_exec "$BACKUP_SERVER" "$server_port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg info $REPO_PATH::$backup_name")
    local size=$(echo "$info" | grep "Original size:" | awk '{print $3}')
    echo "$size"
}

# Восстанавливаем бэкап с отображением прогресса
log_info "Начинаем восстановление бэкапа $BACKUP_NAME на диск /dev/$SOURCE_DISK"

# Получаем размер бэкапа
backup_size=$(get_backup_info "$BACKUP_NAME")
log_info "Размер бэкапа: $backup_size байт"

# Записываем стартовую метку прогресса
log_progress "0"

# Создаем команду для восстановления с прогрессом
RESTORE_CMD="set -o pipefail; BORG_PASSPHRASE='$BORG_PASSPHRASE' \
if command -v pv >/dev/null 2>&1; then \
    # Создаем временный файл для прогресса
    touch /tmp/restore_progress; \
    # Запускаем в фоне процесс обновления прогресса
    (while true; do \
        if [ -e \"/tmp/restore_progress\" ]; then \
            percent=\$(cat /tmp/restore_progress); \
            echo \"[\$(date \"+%Y-%m-%d %H:%M:%S\")] [PROGRESS] \$percent% выполнено\" >> /root/backup.log; \
        fi; \
        sleep 10; \
        # Проверяем, существует ли еще файл прогресса
        if [ ! -e \"/tmp/restore_progress\" ]; then break; fi; \
    done) & \
    MONITOR_PID=\$!; \
    # Запускаем восстановление с отслеживанием прогресса
    (borg extract --stdout $REPO_PATH::$BACKUP_NAME | \
    pv -n -s $backup_size | \
    tee >(echo \"0\" > /tmp/restore_progress; awk -v size=$backup_size 'BEGIN {getline; bytes=\$1} {printf \"%d\\n\", (bytes/size)*100 > \"/tmp/restore_progress\"}') > /dev/$SOURCE_DISK); \
    RESULT=\$?; \
    # Удаляем временный файл прогресса и завершаем монитор
    rm -f /tmp/restore_progress; \
    kill \$MONITOR_PID 2>/dev/null; \
    exit \$RESULT; \
else \
    # Запасной вариант без pv
    echo \"[\$(date \"+%Y-%m-%d %H:%M:%S\")] [WARNING] Утилита pv не найдена, отображение прогресса не доступно\" >> /root/backup.log; \
    borg extract --stdout $REPO_PATH::$BACKUP_NAME > /dev/$SOURCE_DISK; \
fi"

# Выполняем восстановление
if ! remote_exec "$BACKUP_SERVER" "$server_port" "$RESTORE_CMD"; then
    log_error "Не удалось восстановить бэкап $BACKUP_NAME на диск /dev/$SOURCE_DISK"
    exit 1
fi

# Записываем финальную метку прогресса
log_progress "100"

log_info "Бэкап $BACKUP_NAME успешно восстановлен на диск /dev/$SOURCE_DISK" 