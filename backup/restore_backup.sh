#!/bin/bash

# Подключаем функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "${SCRIPT_DIR}/backup_functions.sh"

# Сначала загружаем конфигурацию
load_config

# Проверяем доступность сервера и устанавливаем порт
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

# Очистка некорректных записей в fstab
log_info "Проверка и очистка fstab от некорректных записей..."
remote_exec "$BACKUP_SERVER" "$server_port" "grep -v '[^[:print:]]' /etc/fstab > /tmp/clean_fstab && cat /tmp/clean_fstab > /etc/fstab && rm /tmp/clean_fstab"
log_info "Очистка завершена. Текущий fstab:"
remote_exec "$BACKUP_SERVER" "$server_port" "cat /etc/fstab | grep -v '^#'"

# Функция для определения имени устройства по UUID
get_device_by_uuid() {
    local server=$1
    local port=$2
    local uuid=$3
    local output=$(remote_exec "$server" "$port" "blkid | grep -i \"$uuid\" | cut -d: -f1")
    # Извлекаем только строку с путем устройства
    local device=$(echo "$output" | grep -o '/dev/[a-z0-9]*' | head -n 1)
    echo "$device"
}

# Функция для отображения прогресса
log_progress() {
    local percent=$1
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    echo "[$timestamp] [PROGRESS] $percent% выполнено" | tee -a "$LOG_FILE"
}

# Проверяем аргументы
if [ $# -eq 1 ]; then
    # Пользователь указал имя бэкапа
    BACKUP_NAME="$1"
fi

# Устанавливаем pv для отображения прогресса, если его нет
remote_exec "$BACKUP_SERVER" "$server_port" "which pv > /dev/null || apt-get -y install pv"

# Определяем диски по UUID
if [ -n "$SOURCE_UUID" ]; then
    SOURCE_DEVICE=$(get_device_by_uuid "$BACKUP_SERVER" "$server_port" "$SOURCE_UUID")
    if [ -z "$SOURCE_DEVICE" ]; then
        log_error "Не удалось найти устройство с UUID $SOURCE_UUID"
        # Пытаемся использовать имя устройства как запасной вариант
        SOURCE_DEVICE="/dev/$SOURCE_DISK"
        log_warning "Используем имя устройства $SOURCE_DEVICE вместо UUID"
    else
        log_info "Найдено устройство $SOURCE_DEVICE с UUID $SOURCE_UUID"
    fi
else
    # Если UUID не указан, используем имя устройства
    SOURCE_DEVICE="/dev/$SOURCE_DISK"
    log_warning "UUID источника не найден, используем имя устройства $SOURCE_DEVICE"
    
    # Пытаемся получить UUID по имени устройства
    SOURCE_UUID=$(remote_exec "$BACKUP_SERVER" "$server_port" "blkid -s UUID -o value $SOURCE_DEVICE" | grep -o -E '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -n 1)
    if [ -n "$SOURCE_UUID" ]; then
        log_info "Определен UUID $SOURCE_UUID для устройства $SOURCE_DEVICE"
    fi
fi

if [ -n "$TARGET_UUID" ]; then
    TARGET_DEVICE=$(get_device_by_uuid "$BACKUP_SERVER" "$server_port" "$TARGET_UUID")
    if [ -z "$TARGET_DEVICE" ]; then
        log_error "Не удалось найти устройство с UUID $TARGET_UUID"
        TARGET_DEVICE="/dev/$TARGET_DISK"
        log_warning "Используем имя устройства $TARGET_DEVICE вместо UUID"
    else
        log_info "Найдено устройство $TARGET_DEVICE с UUID $TARGET_UUID"
    fi
else
    TARGET_DEVICE="/dev/$TARGET_DISK"
    log_warning "UUID целевого диска не найден, используем имя устройства $TARGET_DEVICE"
    
    # Пытаемся получить UUID по имени устройства
    TARGET_UUID=$(remote_exec "$BACKUP_SERVER" "$server_port" "blkid -s UUID -o value $TARGET_DEVICE" | grep -o -E '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -n 1)
    if [ -n "$TARGET_UUID" ]; then
        log_info "Определен UUID $TARGET_UUID для устройства $TARGET_DEVICE"
    fi
fi

# Очищаем имена устройств от любых непечатаемых символов
SOURCE_DEVICE=$(echo "$SOURCE_DEVICE" | tr -cd '[:print:]')
TARGET_DEVICE=$(echo "$TARGET_DEVICE" | tr -cd '[:print:]')

# Определяем только имена устройств без /dev/ для дальнейшего использования
SOURCE_DISK_NAME=$(echo "$SOURCE_DEVICE" | sed 's|/dev/||')
TARGET_DISK_NAME=$(echo "$TARGET_DEVICE" | sed 's|/dev/||')

# Определяем путь для репозитория Borg
REPO_PATH="${TARGET_MOUNT}/${REPO_NAME}"

# Проверяем существование репозитория и создаем его, если он не существует
if ! remote_exec "$BACKUP_SERVER" "$server_port" "test -d $REPO_PATH/data" &>/dev/null; then
    log_warning "Репозиторий $REPO_PATH не существует. Попытка инициализации..."
    
    # Проверяем, существует ли точка монтирования
    if ! remote_exec "$BACKUP_SERVER" "$server_port" "test -d $TARGET_MOUNT" &>/dev/null; then
        log_info "Создание точки монтирования $TARGET_MOUNT"
        remote_exec "$BACKUP_SERVER" "$server_port" "mkdir -p $TARGET_MOUNT"
    fi
    
    # Проверяем, смонтирован ли диск
    if ! remote_exec "$BACKUP_SERVER" "$server_port" "mount | grep -q '$TARGET_DEVICE'" &>/dev/null; then
        log_info "Монтирование диска $TARGET_DEVICE в $TARGET_MOUNT"
        
        # Получаем UUID диска
        if [ -z "$TARGET_UUID" ]; then
            TARGET_UUID=$(remote_exec "$BACKUP_SERVER" "$server_port" "blkid -s UUID -o value $TARGET_DEVICE" | grep -o -E '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -n 1)
        fi
        
        # Проверяем и исправляем fstab
        if [ -n "$TARGET_UUID" ]; then
            log_info "Исправление записи в fstab для UUID=$TARGET_UUID"
            
            # Удаляем некорректные записи
            remote_exec "$BACKUP_SERVER" "$server_port" "sed -i '\\,\\s$TARGET_MOUNT\\s,d' /etc/fstab"
            remote_exec "$BACKUP_SERVER" "$server_port" "sed -i '/UUID=$TARGET_UUID/d' /etc/fstab"
            
            # Определяем файловую систему
            fs_type=$(remote_exec "$BACKUP_SERVER" "$server_port" "blkid -s TYPE -o value $TARGET_DEVICE" | head -n 1)
            if [ -z "$fs_type" ]; then
                fs_type="ext4"  # Значение по умолчанию
            fi
            
            # Добавляем новую запись
            remote_exec "$BACKUP_SERVER" "$server_port" "echo 'UUID=$TARGET_UUID $TARGET_MOUNT $fs_type defaults,nofail 0 2' >> /etc/fstab"
            log_info "Запись в fstab обновлена"
        fi
        
        if ! remote_exec "$BACKUP_SERVER" "$server_port" "mount $TARGET_DEVICE $TARGET_MOUNT"; then
            log_error "Не удалось смонтировать диск $TARGET_DEVICE в $TARGET_MOUNT"
            exit 1
        fi
    fi
    
    # Инициализируем репозиторий Borg
    log_info "Инициализация репозитория Borg в $REPO_PATH"
    if ! remote_exec "$BACKUP_SERVER" "$server_port" "mkdir -p $REPO_PATH && BORG_PASSPHRASE='$BORG_PASSPHRASE' borg init --encryption=repokey $REPO_PATH"; then
        log_error "Не удалось инициализировать репозиторий Borg в $REPO_PATH"
        exit 1
    fi
    
    log_info "Репозиторий Borg успешно инициализирован в $REPO_PATH"
    log_warning "Репозиторий был только что создан, поэтому в нем нет бэкапов. Сначала создайте бэкап с помощью setup_backup.sh"
    exit 0
fi

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
echo "ВНИМАНИЕ! Восстановление полностью перезапишет содержимое диска $SOURCE_DEVICE!"
echo "Все данные на диске будут потеряны и заменены данными из бэкапа $BACKUP_NAME."
echo ""
echo -n "Вы уверены, что хотите продолжить? (y/n): "
read CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    log_info "Восстановление отменено пользователем"
    exit 0
fi

# Получаем размер бэкапа
log_info "Получение информации о бэкапе $BACKUP_NAME..."

# Создаем скрипт для получения информации о бэкапе
info_script="/tmp/borg_info_$$.sh"
remote_exec "$BACKUP_SERVER" "$server_port" "cat > $info_script" << EOF
#!/bin/bash
export BORG_PASSPHRASE='$BORG_PASSPHRASE'
echo "Запуск команды: borg info $REPO_PATH::$BACKUP_NAME"
echo "==============================================="
borg info "$REPO_PATH::$BACKUP_NAME"
result=\$?
echo "==============================================="
echo "Код возврата: \$result"
exit \$result
EOF

# Делаем скрипт исполняемым
remote_exec "$BACKUP_SERVER" "$server_port" "chmod +x $info_script"

# Запускаем скрипт и получаем информацию о бэкапе
log_info "Запуск скрипта для информации о бэкапе..."
BORG_INFO=$(remote_exec "$BACKUP_SERVER" "$server_port" "$info_script")
BORG_INFO_STATUS=$?

# Удаляем временный скрипт
remote_exec "$BACKUP_SERVER" "$server_port" "rm -f $info_script"

# Показываем полученную информацию
log_info "Вывод команды borg info:"
echo "$BORG_INFO"

if [ $BORG_INFO_STATUS -ne 0 ]; then
    log_error "Команда borg info завершилась с ошибкой (код: $BORG_INFO_STATUS)"
    exit 1
fi

# Извлекаем размер бэкапа из вывода
# Сначала ищем строку "This archive:", затем извлекаем число и единицу измерения
ARCHIVE_LINE=$(echo "$BORG_INFO" | grep "This archive:")
log_info "Найдена строка: $ARCHIVE_LINE"

# Используем grep с регулярным выражением для извлечения числа и единицы измерения
# Это будет работать с любым форматом чисел: XX.XX, XXX.XX, XX.XXX и т.д.
BACKUP_SIZE_VALUE=$(echo "$ARCHIVE_LINE" | grep -o -E '[0-9]+\.[0-9]+|[0-9]+' | head -n 1)
BACKUP_SIZE_UNIT=$(echo "$ARCHIVE_LINE" | grep -o -E '\b[KMGT]?B\b' | head -n 1)

log_info "Извлеченное значение: $BACKUP_SIZE_VALUE, единица измерения: $BACKUP_SIZE_UNIT"

# Проверяем, что удалось извлечь размер
if [ -z "$BACKUP_SIZE_VALUE" ]; then
    log_error "Не удалось извлечь числовое значение размера бэкапа."
    exit 1
fi

# Если не удалось извлечь единицу измерения, предполагаем байты
if [ -z "$BACKUP_SIZE_UNIT" ]; then
    log_warning "Не удалось определить единицу измерения, используем байты по умолчанию."
    BACKUP_SIZE_UNIT="B"
fi

# Преобразуем значение в байты в зависимости от единицы измерения
case "$BACKUP_SIZE_UNIT" in
    B)
        BACKUP_SIZE=$(echo "$BACKUP_SIZE_VALUE" | awk '{printf "%.0f", $1}')
        ;;
    KB)
        BACKUP_SIZE=$(echo "$BACKUP_SIZE_VALUE" | awk '{printf "%.0f", $1 * 1024}')
        ;;
    MB)
        BACKUP_SIZE=$(echo "$BACKUP_SIZE_VALUE" | awk '{printf "%.0f", $1 * 1024 * 1024}')
        ;;
    GB)
        BACKUP_SIZE=$(echo "$BACKUP_SIZE_VALUE" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024}')
        ;;
    TB)
        BACKUP_SIZE=$(echo "$BACKUP_SIZE_VALUE" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024 * 1024}')
        ;;
    *)
        log_error "Неизвестная единица измерения: $BACKUP_SIZE_UNIT"
        exit 1
        ;;
esac

# Проверяем полученный размер
if [ -z "$BACKUP_SIZE" ] || [ "$BACKUP_SIZE" -eq 0 ]; then
    log_error "Не удалось получить корректный размер бэкапа. Восстановление невозможно."
    exit 1
fi

log_info "Размер бэкапа: $BACKUP_SIZE байт"
log_progress "0"

# Создаем скрипт восстановления на сервере
restore_script="/tmp/restore_script_$$.sh"

# Записываем команду для восстановления напрямую без использования параметров
remote_exec "$BACKUP_SERVER" "$server_port" "cat > $restore_script" << EOF
#!/bin/bash

# Задаем значения напрямую в скрипте
export BORG_PASSPHRASE='$BORG_PASSPHRASE'
REPO_PATH='$REPO_PATH'
BACKUP_NAME='$BACKUP_NAME'
TARGET_DEVICE='$SOURCE_DEVICE'
BACKUP_SIZE='$BACKUP_SIZE'
LOG_FILE="/root/backup.log"

# Функция для логирования
log_message() {
    local level="\$1"
    local message="\$2"
    local timestamp=\$(date "+%Y-%m-%d %H:%M:%S")
    echo "[\$timestamp] [\$level] \$message"
    echo "[\$timestamp] [\$level] \$message" >> "\$LOG_FILE"
}

# Выводим информацию о параметрах
log_message "INFO" "Запуск восстановления с параметрами:"
log_message "INFO" "REPO_PATH: \$REPO_PATH"
log_message "INFO" "BACKUP_NAME: \$BACKUP_NAME"
log_message "INFO" "TARGET_DEVICE: \$TARGET_DEVICE"
log_message "INFO" "BACKUP_SIZE: \$BACKUP_SIZE"

# Проверяем, существуют ли необходимые файлы и устройства
if [ ! -d "\$REPO_PATH" ]; then
    log_message "ERROR" "Репозиторий \$REPO_PATH не существует"
    exit 1
fi

if [ ! -b "\$TARGET_DEVICE" ]; then
    log_message "ERROR" "Устройство \$TARGET_DEVICE не существует или не является блочным устройством"
    exit 1
fi

# Создаем временный файл для прогресса
touch /tmp/restore_progress

# Запускаем в фоне процесс обновления прогресса
(
    while true; do
        if [ -e "/tmp/restore_progress" ]; then
            percent=\$(cat /tmp/restore_progress)
            log_message "PROGRESS" "\$percent% выполнено"
        fi
        sleep 10
        # Проверяем, существует ли еще файл прогресса
        if [ ! -e "/tmp/restore_progress" ]; then 
            break
        fi
    done
) &
MONITOR_PID=\$!

# Устанавливаем начальный прогресс
echo "0" > /tmp/restore_progress

# Проверяем наличие pv
if command -v pv >/dev/null 2>&1; then
    # Запускаем восстановление с отслеживанием прогресса через pv
    set -o pipefail
    borg extract --stdout "\$REPO_PATH::\$BACKUP_NAME" | \\
    pv -n -s "\$BACKUP_SIZE" | \\
    tee >(awk -v size="\$BACKUP_SIZE" 'BEGIN {getline; bytes=\$1} {printf "%d\\n", (bytes/size)*100 > "/tmp/restore_progress"}') > "\$TARGET_DEVICE"
    RESULT=\$?
else
    # Запасной вариант без pv
    log_message "WARNING" "Утилита pv не найдена, отображение прогресса не доступно"
    borg extract --stdout "\$REPO_PATH::\$BACKUP_NAME" > "\$TARGET_DEVICE"
    RESULT=\$?
fi

# Удаляем временный файл прогресса и завершаем монитор
rm -f /tmp/restore_progress
kill \$MONITOR_PID 2>/dev/null || true

exit \$RESULT
EOF

# Делаем скрипт исполняемым
remote_exec "$BACKUP_SERVER" "$server_port" "chmod +x $restore_script"

# Запускаем скрипт восстановления
if ! remote_exec "$BACKUP_SERVER" "$server_port" "$restore_script"; then
    log_error "Не удалось восстановить бэкап $BACKUP_NAME на диск $SOURCE_DEVICE"
    # Удаляем временные файлы
    remote_exec "$BACKUP_SERVER" "$server_port" "rm -f $restore_script"
    exit 1
fi

# Удаляем временные файлы
remote_exec "$BACKUP_SERVER" "$server_port" "rm -f $restore_script"

log_info "Бэкап $BACKUP_NAME успешно восстановлен на диск $SOURCE_DEVICE"
log_progress "100" 