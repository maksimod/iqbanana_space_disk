#!/bin/bash

# Скрипт для настройки системы резервного копирования на удаленном сервере

# Загружаем конфигурацию и общие функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/backup_config.sh"

# Функция для записи в лог
log() {
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1"
    echo "$1"
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
cat > /tmp/make_backup.sh << EOF
#!/bin/bash

# Скрипт резервного копирования для сервера

# Получаем UUID дисков из конфигурации
SOURCE_UUID="$SOURCE_UUID"
BACKUP_DISK_UUID="$TARGET_UUID"
MAX_BACKUPS=$MAX_BACKUPS
CLIENT_IP="$CLIENT_IP"
BACKUP_STATUS_FILE="/root/backup_status.log"

# Записываем в файл статуса
echo "CLIENT_IP=\$CLIENT_IP" > \$BACKUP_STATUS_FILE

# Определяем имена дисков вне зависимости от их доступности
SOURCE_DISK_NAME=\$(lsblk -no pkname,uuid | grep "\$SOURCE_UUID" | awk '{print \$1}' 2>/dev/null)
if [ -z "\$SOURCE_DISK_NAME" ]; then
    # Если диск не найден, используем имя из сохраненной истории или последний известный диск
    SOURCE_DISK_NAME=\$(grep -l "\$SOURCE_UUID" /etc/fstab | xargs cat 2>/dev/null | grep "\$SOURCE_UUID" | awk '{print \$1}' | sed 's/.*\///' 2>/dev/null || echo "sda")
fi

BACKUP_DISK_NAME=\$(lsblk -no pkname,uuid | grep "\$BACKUP_DISK_UUID" | awk '{print \$1}' 2>/dev/null)
if [ -z "\$BACKUP_DISK_NAME" ]; then
    # Если диск не найден, используем имя из сохраненной истории или последний известный диск
    BACKUP_DISK_NAME=\$(grep -l "\$BACKUP_DISK_UUID" /etc/fstab | xargs cat 2>/dev/null | grep "\$BACKUP_DISK_UUID" | awk '{print \$1}' | sed 's/.*\///' 2>/dev/null || echo "sdb")
fi

# Проверка физического наличия дисков
if ! blkid -U "\$BACKUP_DISK_UUID" > /dev/null 2>&1; then
    echo "Ошибка: Физический диск с UUID=\$BACKUP_DISK_UUID не найден в системе"
    echo "STATUS=ERROR" >> \$BACKUP_STATUS_FILE
    echo "DISK=\$BACKUP_DISK_NAME" >> \$BACKUP_STATUS_FILE
    exit 1
fi

if ! blkid -U "\$SOURCE_UUID" > /dev/null 2>&1; then
    echo "Ошибка: Физический диск с UUID=\$SOURCE_UUID не найден в системе"
    echo "STATUS=ERROR" >> \$BACKUP_STATUS_FILE
    echo "DISK=\$SOURCE_DISK_NAME" >> \$BACKUP_STATUS_FILE
    exit 1
fi

# Создание точки монтирования с UUID
if [ ! -d /mnt/backup_\$BACKUP_DISK_UUID ]; then
    sudo mkdir -p /mnt/backup_\$BACKUP_DISK_UUID
    echo "Создана точка монтирования /mnt/backup_\$BACKUP_DISK_UUID"
fi

# Принудительное размонтирование и повторное монтирование для проверки реального доступа к диску
if grep -q "/mnt/backup_\$BACKUP_DISK_UUID" /proc/mounts; then
    sudo umount /mnt/backup_\$BACKUP_DISK_UUID
    echo "Размонтирован существующий диск для проверки"
fi

# Определяем тип файловой системы
FS_TYPE=\$(blkid -s TYPE -o value \$(blkid -U "\$BACKUP_DISK_UUID"))
echo "Тип файловой системы для диска бэкапа: \$FS_TYPE"

# Монтирование диска по UUID с проверкой
if [ -n "\$FS_TYPE" ]; then
    sudo mount -t \$FS_TYPE UUID=\$BACKUP_DISK_UUID /mnt/backup_\$BACKUP_DISK_UUID
else
    # Если не определили тип, пусть система сама определит
    sudo mount UUID=\$BACKUP_DISK_UUID /mnt/backup_\$BACKUP_DISK_UUID
fi

if [ \$? -ne 0 ]; then
    echo "Ошибка: Не удалось смонтировать диск бэкапа с UUID=\$BACKUP_DISK_UUID"
    echo "STATUS=ERROR" >> \$BACKUP_STATUS_FILE
    echo "DISK=\$BACKUP_DISK_NAME" >> \$BACKUP_STATUS_FILE
    exit 1
fi
echo "Диск смонтирован в /mnt/backup_\$BACKUP_DISK_UUID"

# Проверка записи на диск бэкапа
if ! touch /mnt/backup_\$BACKUP_DISK_UUID/test_write_access && rm /mnt/backup_\$BACKUP_DISK_UUID/test_write_access; then
    echo "Ошибка: Нет доступа на запись в точку монтирования /mnt/backup_\$BACKUP_DISK_UUID"
    echo "STATUS=ERROR" >> \$BACKUP_STATUS_FILE
    echo "DISK=\$BACKUP_DISK_NAME" >> \$BACKUP_STATUS_FILE
    exit 1
fi

# Получение точки монтирования исходного диска
SOURCE_MOUNT=\$(findmnt -n -o TARGET -S UUID=\$SOURCE_UUID)
if [ -z "\$SOURCE_MOUNT" ]; then
    # Пробуем смонтировать исходный диск
    TEMP_MOUNT="/mnt/source_\$SOURCE_UUID"
    mkdir -p "\$TEMP_MOUNT"
    if ! mount UUID=\$SOURCE_UUID "\$TEMP_MOUNT"; then
        echo "Ошибка: Исходный диск с UUID=\$SOURCE_UUID не может быть смонтирован"
        echo "STATUS=ERROR" >> \$BACKUP_STATUS_FILE
        echo "DISK=\$SOURCE_DISK_NAME" >> \$BACKUP_STATUS_FILE
        exit 1
    fi
    SOURCE_MOUNT="\$TEMP_MOUNT"
fi

# Проверка чтения с исходного диска
if ! ls -la "\$SOURCE_MOUNT" > /dev/null 2>&1; then
    echo "Ошибка: Нет доступа на чтение с исходного диска \$SOURCE_MOUNT"
    echo "STATUS=ERROR" >> \$BACKUP_STATUS_FILE
    echo "DISK=\$SOURCE_DISK_NAME" >> \$BACKUP_STATUS_FILE
    exit 1
fi

# Создание архива с меткой текущего времени
BACKUP_DATE=\$(date +"%Y%m%d_%H%M%S")
echo "DISK=\$SOURCE_DISK_NAME" >> \$BACKUP_STATUS_FILE
echo "Создание архива из \$SOURCE_MOUNT в /mnt/backup_\$BACKUP_DISK_UUID/nfs_backup_\$BACKUP_DATE.tar.gz"

# Выполняем архивацию и проверяем результат
tar -czf /mnt/backup_\$BACKUP_DISK_UUID/nfs_backup_\$BACKUP_DATE.tar.gz -C \$SOURCE_MOUNT .
TAR_RESULT=\$?

# Проверяем, что файл архива существует и имеет ненулевой размер
if [ \$TAR_RESULT -eq 0 ] && [ -s "/mnt/backup_\$BACKUP_DISK_UUID/nfs_backup_\$BACKUP_DATE.tar.gz" ]; then
    echo "Резервное копирование успешно выполнено: /mnt/backup_\$BACKUP_DISK_UUID/nfs_backup_\$BACKUP_DATE.tar.gz"
    echo "STATUS=SUCCESS" >> \$BACKUP_STATUS_FILE
else
    echo "Ошибка при создании архива или созданный архив пуст"
    echo "STATUS=ERROR" >> \$BACKUP_STATUS_FILE
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
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -P "$BACKUP_SERVER_PORT" /tmp/make_backup.sh root@$BACKUP_SERVER:/root/make_backup.sh
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
chmod_command="chmod +x /root/make_backup.sh && echo 'Права на выполнение скрипта установлены'"
log "Установка прав на скрипт на сервере $BACKUP_SERVER"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "$chmod_command"

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