#!/bin/bash

# Скрипт для автоматического резервного копирования данных

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
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1" >> "$LOG_FILE"
    echo "$1"
}

# Проверка подключения к серверу
log "Проверка подключения к серверу $BACKUP_SERVER через порт $SERVER_PORT"
if ! check_server "$BACKUP_SERVER" "$SERVER_PORT"; then
    log "Ошибка: Не удалось подключиться к серверу $BACKUP_SERVER"
    exit 1
fi

# Создание точки монтирования, если она не существует
mount_command="
if [ ! -d /mnt/backup_$TARGET_UUID ]; then
    sudo mkdir -p /mnt/backup_$TARGET_UUID
    echo 'Создана точка монтирования /mnt/backup_$TARGET_UUID'
else
    echo 'Точка монтирования /mnt/backup_$TARGET_UUID уже существует'
fi
"
log "Создание точки монтирования на сервере $BACKUP_SERVER"
remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$mount_command"

# Проверка и монтирование диска, если не смонтирован
mount_disk_command="
if ! grep -q '/mnt/backup_$TARGET_UUID' /proc/mounts; then
    sudo mount UUID=$TARGET_UUID /mnt/backup_$TARGET_UUID
    if [ \$? -eq 0 ]; then
        echo 'Диск успешно смонтирован в /mnt/backup_$TARGET_UUID'
    else
        echo 'Ошибка монтирования диска'
        exit 1
    fi
else
    echo 'Диск уже смонтирован в /mnt/backup_$TARGET_UUID'
fi
"
log "Монтирование диска резервного копирования на сервере $BACKUP_SERVER"
remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$mount_disk_command"

# Выполнение резервного копирования
backup_command="
# Создание архива с меткой текущего времени
BACKUP_DATE=\$(date +\"%Y%m%d_%H%M%S\")
echo \"Создание резервной копии: \$BACKUP_DATE\"

# Поиск точки монтирования для исходного диска
SOURCE_MOUNT=\$(findmnt -n -o TARGET -S UUID=$SOURCE_UUID)
if [ -z \"\$SOURCE_MOUNT\" ]; then
    echo \"Ошибка: Диск с UUID=$SOURCE_UUID не смонтирован\"
    exit 1
fi

# Создаем архив
echo \"Создание архива из \$SOURCE_MOUNT в /mnt/backup_$TARGET_UUID/nfs_backup_\$BACKUP_DATE.tar.gz\"
sudo tar -czf /mnt/backup_$TARGET_UUID/nfs_backup_\$BACKUP_DATE.tar.gz -C \$SOURCE_MOUNT .
if [ \$? -eq 0 ]; then
    echo \"Резервное копирование успешно выполнено: /mnt/backup_$TARGET_UUID/nfs_backup_\$BACKUP_DATE.tar.gz\"
else
    echo \"Ошибка при создании архива\"
    exit 1
fi

# Удаляем старые бэкапы если их количество превышает максимальное
BACKUP_COUNT=\$(ls -1 /mnt/backup_$TARGET_UUID/nfs_backup_*.tar.gz 2>/dev/null | wc -l)
if [ \$BACKUP_COUNT -gt $MAX_BACKUPS ]; then
    # Сортируем по дате и удаляем самые старые
    BACKUPS_TO_REMOVE=\$((\$BACKUP_COUNT - $MAX_BACKUPS))
    echo \"Удаление \$BACKUPS_TO_REMOVE устаревших резервных копий\"
    
    ls -1t /mnt/backup_$TARGET_UUID/nfs_backup_*.tar.gz | tail -n \$BACKUPS_TO_REMOVE | xargs rm -f
    echo \"\$BACKUPS_TO_REMOVE старых резервных копий успешно удалены\"
fi
"
log "Выполнение резервного копирования на сервере $BACKUP_SERVER"
remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$backup_command"

# Добавление задачи в cron, если её ещё нет
add_cron_command="
if ! sudo crontab -l | grep -q 'auto_backup.sh'; then
    # Создаем временный файл с существующими и новыми задачами
    sudo crontab -l > /tmp/current_crontab 2>/dev/null || echo \"\" > /tmp/current_crontab
    
    # Добавляем новую задачу в соответствии с частотой
    case \"$BACKUP_FREQUENCY\" in
        hourly)
            echo \"0 * * * * $SCRIPT_DIR/auto_backup.sh >> $LOG_FILE 2>&1\" >> /tmp/current_crontab
            ;;
        daily)
            echo \"0 0 * * * $SCRIPT_DIR/auto_backup.sh >> $LOG_FILE 2>&1\" >> /tmp/current_crontab
            ;;
        weekly)
            echo \"0 0 * * 0 $SCRIPT_DIR/auto_backup.sh >> $LOG_FILE 2>&1\" >> /tmp/current_crontab
            ;;
        monthly)
            echo \"0 0 1 * * $SCRIPT_DIR/auto_backup.sh >> $LOG_FILE 2>&1\" >> /tmp/current_crontab
            ;;
        *)
            echo \"Неизвестная частота бэкапа: $BACKUP_FREQUENCY, используем daily\"
            echo \"0 0 * * * $SCRIPT_DIR/auto_backup.sh >> $LOG_FILE 2>&1\" >> /tmp/current_crontab
            ;;
    esac
    
    # Применяем новый crontab
    sudo crontab /tmp/current_crontab
    rm /tmp/current_crontab
    echo \"Задача резервного копирования добавлена в crontab\"
else
    echo \"Задача резервного копирования уже существует в crontab\"
fi
"
log "Настройка расписания резервного копирования на сервере $BACKUP_SERVER"
remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$add_cron_command"

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

log "Процесс настройки резервного копирования завершен успешно"
exit 0 