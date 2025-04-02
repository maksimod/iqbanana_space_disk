#!/bin/bash

# Скрипт для настройки системы резервного копирования на удаленном сервере

# Загружаем конфигурацию и общие функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/backup_config.sh"
source "$SCRIPT_DIR/../nfs/common_functions.sh"

# Загружаем переменные окружения
if [ -f "$SCRIPT_DIR/../nfs/.env" ]; then
    source "$SCRIPT_DIR/../nfs/.env"
else
    echo "Ошибка: Файл .env не найден."
    exit 1
fi

# Используем значение из .env или дефолтное значение из конфигурации
SSH_HOST="${SSH_HOST:-$DEFAULT_SSH_HOST}"

# Используем порт из конфигурации
SERVER_PORT="$BACKUP_SERVER_PORT"

if [ -z "$SERVER_PORT" ]; then
    echo "Ошибка: Не указан SSH порт для сервера $BACKUP_SERVER в конфигурации."
    exit 1
fi

# Функция для записи в лог
log() {
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1"
    echo "$1"
}

# Проверка подключения к серверу
log "Проверка подключения к серверу $BACKUP_SERVER через порт $SERVER_PORT"
if ! check_server "$BACKUP_SERVER" "$SERVER_PORT"; then
    log "Ошибка: Не удалось подключиться к серверу $BACKUP_SERVER"
    exit 1
fi

# Получаем пароль для сервера
server_var="SERVER_$(echo $BACKUP_SERVER | tr '.' '_')_PASSWORD"
server_password="${!server_var}"

if [ -z "$server_password" ]; then
    log "Ошибка: Не установлена переменная $server_var в .env"
    exit 1
fi

# Создаем временный файл с серверным скриптом
cat > /tmp/make_backup.sh << EOF
#!/bin/bash

# Простой скрипт резервного копирования для сервера

# Получаем UUID дисков из конфигурации
SOURCE_UUID="$SOURCE_UUID"
BACKUP_DISK_UUID="$TARGET_UUID"
MAX_BACKUPS=$MAX_BACKUPS

# Создание точки монтирования с UUID
if [ ! -d /mnt/backup_\$BACKUP_DISK_UUID ]; then
    sudo mkdir -p /mnt/backup_\$BACKUP_DISK_UUID
    echo "Создана точка монтирования /mnt/backup_\$BACKUP_DISK_UUID"
fi

# Монтирование диска по UUID, если он не смонтирован
if ! grep -q "/mnt/backup_\$BACKUP_DISK_UUID" /proc/mounts; then
    sudo mount UUID=\$BACKUP_DISK_UUID /mnt/backup_\$BACKUP_DISK_UUID
    if [ \$? -ne 0 ]; then
        echo "Ошибка: Не удалось смонтировать диск бэкапа с UUID=\$BACKUP_DISK_UUID"
        exit 1
    fi
    echo "Диск смонтирован в /mnt/backup_\$BACKUP_DISK_UUID"
fi

# Получение точки монтирования исходного диска
SOURCE_MOUNT=\$(findmnt -n -o TARGET -S UUID=\$SOURCE_UUID)
if [ -z "\$SOURCE_MOUNT" ]; then
    echo "Ошибка: Исходный диск с UUID=\$SOURCE_UUID не смонтирован"
    exit 1
fi

# Создание архива с меткой текущего времени
BACKUP_DATE=\$(date +"%Y%m%d_%H%M%S")
echo "Создание архива из \$SOURCE_MOUNT в /mnt/backup_\$BACKUP_DISK_UUID/nfs_backup_\$BACKUP_DATE.tar.gz"
tar -czf /mnt/backup_\$BACKUP_DISK_UUID/nfs_backup_\$BACKUP_DATE.tar.gz -C \$SOURCE_MOUNT .

# Проверка результата
if [ \$? -eq 0 ]; then
    echo "Резервное копирование успешно выполнено: /mnt/backup_\$BACKUP_DISK_UUID/nfs_backup_\$BACKUP_DATE.tar.gz"
else
    echo "Ошибка при создании архива"
    exit 1
fi

# Удаление старых бэкапов если их количество превышает максимальное
BACKUP_COUNT=\$(ls -1 /mnt/backup_\$BACKUP_DISK_UUID/nfs_backup_*.tar.gz 2>/dev/null | wc -l)
if [ \$BACKUP_COUNT -gt $MAX_BACKUPS ]; then
    BACKUPS_TO_REMOVE=\$((\$BACKUP_COUNT - $MAX_BACKUPS))
    echo "Удаление \$BACKUPS_TO_REMOVE устаревших резервных копий"
    
    ls -1t /mnt/backup_\$BACKUP_DISK_UUID/nfs_backup_*.tar.gz | tail -n \$BACKUPS_TO_REMOVE | xargs rm -f
    echo "\$BACKUPS_TO_REMOVE старых резервных копий успешно удалены"
fi

exit 0
EOF

# Копируем скрипт на сервер
log "Копирование скрипта резервного копирования на сервер $BACKUP_SERVER"
sshpass -p "$server_password" scp -P "$SERVER_PORT" -o StrictHostKeyChecking=no /tmp/make_backup.sh root@$SSH_HOST:/root/make_backup.sh
if [ $? -eq 0 ]; then
    log "Скрипт резервного копирования успешно скопирован на сервер"
    # Удаляем временный файл
    rm /tmp/make_backup.sh
else
    log "Ошибка при копировании скрипта на сервер"
    # Удаляем временный файл
    rm /tmp/make_backup.sh
    exit 1
fi

# Установка прав на скрипт
chmod_command="
chmod +x /root/make_backup.sh
echo 'Права на выполнение скрипта установлены'
"
log "Установка прав на скрипт на сервере $BACKUP_SERVER"
remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$chmod_command"

# Добавление записи в fstab, если её ещё нет
add_fstab_command="
if ! grep -q 'UUID=$TARGET_UUID' /etc/fstab; then
    echo \"UUID=$TARGET_UUID /mnt/backup_$TARGET_UUID ext4 defaults,nofail 0 2\" | sudo tee -a /etc/fstab > /dev/null
    echo \"Запись для диска резервного копирования добавлена в /etc/fstab\"
else
    echo \"Запись для диска резервного копирования уже существует в /etc/fstab\"
fi
"
log "Настройка автоматического монтирования диска резервного копирования"
remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$add_fstab_command"

# Добавление задачи в cron, если её ещё нет
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
remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$add_cron_command"

log "Процесс настройки резервного копирования завершен успешно"
exit 0 