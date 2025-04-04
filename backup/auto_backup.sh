#!/bin/bash

# Скрипт для настройки системы резервного копирования на удаленном сервере

# Загружаем конфигурацию и общие функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/backup_config.sh"

# Получаем API ключ из .env файла бэкенда или используем значение по умолчанию
BACKEND_ENV_FILE="/home/user/iqbanana_space_disk/backend/.env"
API_KEY="backup_system_api_key_secure"
API_URL="http://localhost:6005"

if [ -f "$BACKEND_ENV_FILE" ]; then
    # Извлекаем API_KEY из .env файла
    ENV_API_KEY=$(grep API_KEY $BACKEND_ENV_FILE | cut -d'=' -f2 | tr -d '\r')
    if [ -n "$ENV_API_KEY" ]; then
        API_KEY="$ENV_API_KEY"
    fi
    
    # Получаем порт из .env, если есть
    ENV_PORT=$(grep PORT $BACKEND_ENV_FILE | cut -d'=' -f2 | tr -d '\r')
    if [ -n "$ENV_PORT" ]; then
        API_URL="http://localhost:$ENV_PORT"
    fi
fi

# Функция для записи в лог
log() {
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1"
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1" >> "$LOG_FILE"
}

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

# Создаем временный файл с серверным скриптом
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

# Копируем скрипт make_backup.sh на сервер
log "Копирование скрипта резервного копирования на сервер $BACKUP_SERVER"
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -P "$BACKUP_SERVER_PORT" /tmp/make_backup.sh root@$BACKUP_SERVER:/root/make_backup.sh
if [ $? -eq 0 ]; then
    log "Скрипт резервного копирования успешно скопирован на сервер"
else
    log "Ошибка при копировании скрипта на сервер"
    rm /tmp/make_backup.sh
    exit 1
fi

# Создаем скрипт для настройки cron задания
cat > /tmp/setup_backup_cron.sh << 'EOF'
#!/bin/bash

# Скрипт для настройки cron-задания для резервного копирования
# Использование: ./setup_backup_cron.sh disk_name api_key api_url backup_path [interval]

# Проверка аргументов
if [ $# -lt 4 ]; then
    echo "Использование: $0 disk_name api_key api_url backup_path [interval]"
    echo "  disk_name   - Имя диска для бэкапа"
    echo "  api_key     - Ключ API для отправки статусов"
    echo "  api_url     - URL API сервера (например: http://localhost:6005)"
    echo "  backup_path - Путь для сохранения бэкапов"
    echo "  interval    - Интервал бэкапов (daily, weekly, monthly). По умолчанию: daily"
    exit 1
fi

DISK_NAME="$1"
API_KEY="$2"
API_URL="$3"
BACKUP_PATH="$4"
INTERVAL="${5:-daily}"

# Путь к скрипту make_backup.sh
BACKUP_SCRIPT="/root/make_backup.sh"

# Проверка наличия скрипта для резервного копирования
if [ ! -f "$BACKUP_SCRIPT" ]; then
    echo "Ошибка: Скрипт $BACKUP_SCRIPT не найден"
    exit 1
fi

# Делаем скрипт исполняемым
chmod +x "$BACKUP_SCRIPT"

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

# Формируем команду для cron
BACKUP_CMD="$BACKUP_SCRIPT $DISK_NAME $BACKUP_PATH $API_KEY $API_URL $INTERVAL"

# Проверяем, существует ли уже задание для этого диска
EXISTING_CRON=$(crontab -l 2>/dev/null | grep -F "$DISK_NAME $BACKUP_PATH")

if [ -n "$EXISTING_CRON" ]; then
    # Обновляем существующее задание
    echo "Обновляем существующее cron-задание для диска $DISK_NAME"
    (crontab -l 2>/dev/null | grep -v "$DISK_NAME $BACKUP_PATH"; echo "$CRON_EXPR $BACKUP_CMD") | crontab -
else
    # Добавляем новое задание
    echo "Добавляем новое cron-задание для диска $DISK_NAME"
    (crontab -l 2>/dev/null; echo "$CRON_EXPR $BACKUP_CMD") | crontab -
fi

# Проверяем, добавилось ли задание
if crontab -l 2>/dev/null | grep -q "$DISK_NAME $BACKUP_PATH"; then
    echo "Cron-задание успешно установлено для диска $DISK_NAME с интервалом $INTERVAL"
    echo "Расписание: $CRON_EXPR"
    echo "Команда: $BACKUP_CMD"
else
    echo "Ошибка: Не удалось добавить cron-задание"
    exit 1
fi

exit 0
EOF

# Копируем скрипт setup_backup_cron.sh на сервер
log "Копирование скрипта настройки cron на сервер $BACKUP_SERVER"
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -P "$BACKUP_SERVER_PORT" /tmp/setup_backup_cron.sh root@$BACKUP_SERVER:/root/setup_backup_cron.sh
if [ $? -eq 0 ]; then
    log "Скрипт настройки cron успешно скопирован на сервер"
    # Удаляем временный файл
    rm /tmp/setup_backup_cron.sh
else
    log "Ошибка при копировании скрипта на сервер"
    # Удаляем временный файл
    rm /tmp/setup_backup_cron.sh
    exit 1
fi

# Установка прав на скрипты
log "Установка прав на скрипты на сервере $BACKUP_SERVER"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "chmod +x /root/make_backup.sh /root/setup_backup_cron.sh && echo 'Права на выполнение скриптов установлены'"

# Настраиваем cron задание на сервере с использованием нового скрипта
log "Настройка cron задания для резервного копирования на сервере"
DISK_NAME=$(echo $SOURCE_UUID | cut -d'-' -f1)
BACKUP_PATH="/mnt/backup_${TARGET_UUID}"

ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "/root/setup_backup_cron.sh $DISK_NAME $API_KEY $API_URL $BACKUP_PATH $BACKUP_FREQUENCY"

# Запускаем скрипт бэкапа немедленно, если указано
if [ "$1" == "now" ]; then
    log "Запуск немедленного резервного копирования..."
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "/root/make_backup.sh $DISK_NAME $BACKUP_PATH $API_KEY $API_URL $BACKUP_FREQUENCY"
    
    # Проверяем статус выполнения
    if [ $? -eq 0 ]; then
        log "Резервное копирование успешно выполнено"
    else
        log "Ошибка при выполнении резервного копирования"
    fi
fi

# Добавление записи в fstab, если её ещё нет
add_fstab_command="
# Определяем тип файловой системы диска
FS_TYPE=\$(blkid -s TYPE -o value /dev/\$(lsblk -no pkname,uuid | grep \"\$BACKUP_DISK_UUID\" | awk '{print \$1}'))
if [ -z \"\$FS_TYPE\" ]; then
    FS_TYPE=\$(blkid | grep \"\$BACKUP_DISK_UUID\" | grep -o 'TYPE=\"[^\"]*\"' | cut -d'\"' -f2)
fi

if [ -z \"\$FS_TYPE\" ]; then
    echo \"Не удалось определить тип файловой системы, используем ext4 по умолчанию\"
    FS_TYPE=\"ext4\"
else
    echo \"Определен тип файловой системы: \$FS_TYPE\"
fi

# Проверяем, есть ли уже запись в fstab
if ! grep -q 'UUID=$TARGET_UUID' /etc/fstab; then
    echo \"UUID=$TARGET_UUID /mnt/backup_$TARGET_UUID \$FS_TYPE defaults,nofail 0 2\" | sudo tee -a /etc/fstab > /dev/null
    echo \"Запись для диска резервного копирования добавлена в /etc/fstab\"
    
    # Создаем точку монтирования, если она еще не существует
    mkdir -p /mnt/backup_$TARGET_UUID
    
    # Монтируем диск сразу после добавления записи в fstab
    echo \"Монтирование диска резервного копирования...\"
    mount UUID=$TARGET_UUID /mnt/backup_$TARGET_UUID
    
    # Проверяем, смонтировался ли диск
    if mount | grep -q \"/mnt/backup_$TARGET_UUID\"; then
        echo \"Диск успешно смонтирован в /mnt/backup_$TARGET_UUID\"
    else
        echo \"Ошибка: Не удалось смонтировать диск. Попробуйте выполнить команду 'mount -a'\"
    fi
else
    echo \"Запись для диска резервного копирования уже существует в /etc/fstab\"
    
    # Проверяем, смонтирован ли диск
    if ! mount | grep -q \"/mnt/backup_$TARGET_UUID\"; then
        echo \"Диск не смонтирован. Попытка монтирования...\"
        mount UUID=$TARGET_UUID /mnt/backup_$TARGET_UUID || mount -a
    fi
fi
"
log "Настройка автоматического монтирования диска резервного копирования"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "$add_fstab_command"

# Создание скрипта для проверки статуса и обновления файла backups.yml
cat > /tmp/check_backup_status.sh << EOF
#!/bin/bash

# Скрипт для проверки статуса резервного копирования и обновления файла backups.yml
SSH_KEY_PATH="$SSH_KEY_PATH"
BACKUP_SERVER="$BACKUP_SERVER"
BACKUP_SERVER_PORT="$BACKUP_SERVER_PORT"
BACKUP_STATUS_FILE="/root/backup_status.log"
BACKUPS_YML_FILE="/home/user/iqbanana_space_disk/monitor/backups.yml"

# Выполняем команду для получения статуса с сервера
status_output=\$(ssh -i "\$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "\$BACKUP_SERVER_PORT" "root@\$BACKUP_SERVER" "cat \$BACKUP_STATUS_FILE 2>/dev/null || echo 'STATUS=UNKNOWN'")

# Парсим вывод для получения параметров
CLIENT_IP=\$(echo "\$status_output" | grep "CLIENT_IP" | cut -d'=' -f2)
STATUS=\$(echo "\$status_output" | grep "STATUS" | cut -d'=' -f2)
DISK=\$(echo "\$status_output" | grep "DISK" | cut -d'=' -f2)

# Проверяем, что получили все параметры
if [ -z "\$CLIENT_IP" ] || [ -z "\$STATUS" ] || [ -z "\$DISK" ]; then
    echo "Ошибка: Не удалось получить параметры статуса"
    exit 1
fi

DISK_NAME="\$CLIENT_IP/\$DISK"
echo "Обновление статуса для диска \$DISK_NAME: \$STATUS"

# Проверяем, существует ли файл backups.yml
if [ ! -f "\$BACKUPS_YML_FILE" ]; then
    echo "Создание файла \$BACKUPS_YML_FILE"
    echo "DISKS_STATUSES:" > "\$BACKUPS_YML_FILE"
fi

# Проверяем, существует ли запись для этого диска
if grep -q "\$DISK_NAME" "\$BACKUPS_YML_FILE"; then
    # Заменяем статус, если запись существует
    sed -i "s/\\(name: \"\$DISK_NAME\"\\n  status: \\)\"[A-Z]*\"/\\1\"\$STATUS\"/" "\$BACKUPS_YML_FILE"
else
    # Добавляем новую запись, если её нет
    echo "  - name: \"\$DISK_NAME\"" >> "\$BACKUPS_YML_FILE"
    echo "    status: \"\$STATUS\"" >> "\$BACKUPS_YML_FILE"
fi

echo "Статус резервного копирования обновлен"
EOF

# Копируем скрипт проверки статуса на клиент
log "Копирование скрипта проверки статуса на клиент"
chmod +x /tmp/check_backup_status.sh
cp /tmp/check_backup_status.sh "$SCRIPT_DIR/check_backup_status.sh"
rm /tmp/check_backup_status.sh

# Добавление задачи в cron на сервере
add_cron_command="
CRON_ENTRY=\"\"
case \"$BACKUP_FREQUENCY\" in
    hourly)
        CRON_ENTRY=\"0 * * * * /root/make_backup.sh >> /root/backup.log 2>&1\"
        ;;
    daily)
        CRON_ENTRY=\"0 0 * * * /root/make_backup.sh >> /root/backup.log 2>&1\"
        ;;
    weekly)
        CRON_ENTRY=\"0 0 * * 0 /root/make_backup.sh >> /root/backup.log 2>&1\"
        ;;
    monthly)
        CRON_ENTRY=\"0 0 1 * * /root/make_backup.sh >> /root/backup.log 2>&1\"
        ;;
    *)
        echo \"Неизвестная частота бэкапа: $BACKUP_FREQUENCY, используем daily\"
        CRON_ENTRY=\"0 0 * * * /root/make_backup.sh >> /root/backup.log 2>&1\"
        ;;
esac

# Проверяем, есть ли уже задача в cron
EXISTING_CRON=\$(sudo crontab -l 2>/dev/null | grep -v '^#' | grep \"make_backup.sh\" || echo \"\")

if [ -z \"\$EXISTING_CRON\" ]; then
    # Создаем временный файл с существующими и новыми задачами
    echo \"Добавление задачи резервного копирования в crontab\"
    sudo crontab -l > /tmp/current_crontab 2>/dev/null || echo \"\" > /tmp/current_crontab
    echo \"\$CRON_ENTRY\" >> /tmp/current_crontab
    sudo crontab /tmp/current_crontab
    rm /tmp/current_crontab
elif [ \"\$EXISTING_CRON\" != \"\$CRON_ENTRY\" ]; then
    # Если задача есть, но с другой частотой или путем, заменяем её
    echo \"Обновление существующей задачи резервного копирования в crontab\"
    sudo crontab -l | sed \"s|.*make_backup.sh.*|\$CRON_ENTRY|\" > /tmp/current_crontab
    sudo crontab /tmp/current_crontab
    rm /tmp/current_crontab
else
    echo \"Задача резервного копирования уже настроена с нужной частотой\"
fi
"
log "Настройка расписания резервного копирования на сервере $BACKUP_SERVER"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "$add_cron_command"

# Добавление задачи в cron на клиенте для проверки статуса
add_client_cron_command="
CRON_ENTRY=\"5 * * * * $SCRIPT_DIR/check_backup_status.sh >> $SCRIPT_DIR/check_status.log 2>&1\"

# Проверяем, есть ли уже задача в cron
EXISTING_CRON=\$(crontab -l 2>/dev/null | grep -v '^#' | grep \"check_backup_status.sh\" || echo \"\")

if [ -z \"\$EXISTING_CRON\" ]; then
    # Создаем временный файл с существующими и новыми задачами
    echo \"Добавление задачи проверки статуса в crontab\"
    crontab -l > /tmp/current_crontab 2>/dev/null || echo \"\" > /tmp/current_crontab
    echo \"\$CRON_ENTRY\" >> /tmp/current_crontab
    crontab /tmp/current_crontab
    rm /tmp/current_crontab
    echo \"Задача проверки статуса резервного копирования добавлена в crontab\"
elif [ \"\$EXISTING_CRON\" != \"\$CRON_ENTRY\" ]; then
    # Если задача есть, но с другой частотой или путем, заменяем её
    echo \"Обновление существующей задачи проверки статуса в crontab\"
    crontab -l | sed \"s|.*check_backup_status.sh.*|\$CRON_ENTRY|\" > /tmp/current_crontab
    crontab /tmp/current_crontab
    rm /tmp/current_crontab
    echo \"Задача проверки статуса резервного копирования обновлена в crontab\"
else
    echo \"Задача проверки статуса резервного копирования уже настроена с нужной частотой\"
fi
"
log "Настройка расписания проверки статуса на клиенте"
eval "$add_client_cron_command"

# Запускаем скрипт проверки статуса для немедленного обновления
log "Запуск скрипта проверки статуса для немедленного обновления"
"$SCRIPT_DIR/check_backup_status.sh"

log "Процесс настройки резервного копирования завершен успешно"
exit 0 