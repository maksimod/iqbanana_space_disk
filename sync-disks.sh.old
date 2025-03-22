#!/bin/bash

# Настройки
REMOTE_IP="192.168.0.104"
REMOTE_USER="agger"
REMOTE_FSTAB="/etc/fstab"
LOCAL_FSTAB="/etc/fstab"
BACKEND_CONFIG="/home/apper/iqbanana-disk/backend/config/config.js"
MOUNT_PREFIX="/mnt"
SAMBA_USER="agger"
SAMBA_PASS="2864"
LOCAL_USER="apper"  # Пользователь, от имени которого будут монтироваться диски
LOG_FILE="/var/log/sync-disks.log"
TRIGGER_FILE="/tmp/sync_trigger"

# Функция для логирования
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Создаём лог-файл с правильными правами, если его нет
mkdir -p /var/log
touch "$LOG_FILE"
sudo chown "$LOCAL_USER":"$LOCAL_USER" "$LOG_FILE"
sudo chmod 644 "$LOG_FILE"

# Проверка триггера или периодического запуска
if [ ! -f "$TRIGGER_FILE" ] && [ "$1" != "--force" ]; then
    log "Триггер $TRIGGER_FILE не найден, пропускаю выполнение"
    exit 0
fi

# Удаляем триггер после активации
[ -f "$TRIGGER_FILE" ] && sudo rm -f "$TRIGGER_FILE" 2>/dev/null

# Ожидание полной инициализации сети
log "Ожидание полной инициализации сети..."
sleep 5

# Проверка SSH-соединения
log "Проверка SSH-доступа к $REMOTE_IP..."
SSH_CMD="ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 $REMOTE_USER@$REMOTE_IP"
if ! $SSH_CMD "echo test" >/dev/null 2>&1; then
    log "ОШИБКА: Не удалось подключиться к $REMOTE_IP по SSH"
    $SSH_CMD "echo test" 2>&1 | while IFS= read -r line; do log "  $line"; done
    exit 1
fi

# Установка cifs-utils
log "Установка cifs-utils..."
sudo apt install -y cifs-utils 2>/dev/null || log "Не удалось установить cifs-utils"

# Проверка доступности Samba-сервера и получение списка шар
log "Проверка доступности Samba-сервера на $REMOTE_IP..."
SAMBA_SHARES=$(smbclient -L //$REMOTE_IP -U $SAMBA_USER%$SAMBA_PASS -t 10 2>/dev/null)
if [ $? -ne 0 ]; then
    log "ОШИБКА: Не удалось подключиться к Samba-серверу $REMOTE_IP"
    exit 1
fi

# Сохраняем список шар в лог
echo "$SAMBA_SHARES" | while IFS= read -r line; do log "  $line"; done

# Создаем словарь доступных шар (для проверки правильности имен)
declare -A AVAILABLE_SHARES
while read -r line; do
    if [[ "$line" =~ DISK_ ]]; then
        share_name=$(echo "$line" | awk '{print $1}')
        AVAILABLE_SHARES["$share_name"]=1
        log "Найдена шара: $share_name"
    fi
done <<< "$SAMBA_SHARES"

# Получение содержимого удаленного /etc/fstab с таймаутом
log "Получение /etc/fstab с удаленного сервера $REMOTE_IP..."
REMOTE_FSTAB_CONTENT=$($SSH_CMD "cat $REMOTE_FSTAB" 2>&1)
if [ $? -ne 0 ]; then
    log "ОШИБКА: Не удалось выполнить команду cat $REMOTE_FSTAB на удаленном сервере"
    echo "$REMOTE_FSTAB_CONTENT" | while IFS= read -r line; do log "  $line"; done
    exit 1
fi

if [ -z "$REMOTE_FSTAB_CONTENT" ]; then
    log "ОШИБКА: Не удалось получить /etc/fstab с удаленного сервера или файл пуст"
    exit 1
fi

# Логируем содержимое удалённого fstab для отладки
log "Содержимое удалённого /etc/fstab:"
echo "$REMOTE_FSTAB_CONTENT" | while IFS= read -r line; do log "  $line"; done

# Очищаем локальный fstab от предыдущих автоматических записей и старых комментариев
log "Очистка локального fstab от старых автоматических записей..."
sudo grep -v -e "# AUTO-MOUNTED" -e "# Автоматически смонтированные диски" $LOCAL_FSTAB > /tmp/fstab.new
sudo bash -c "echo -e '\n# Автоматически смонтированные диски - не редактировать' >> /tmp/fstab.new"

# Очищаем точки монтирования
log "Размонтирование старых точек монтирования..."
for mount in $(mount | grep "$MOUNT_PREFIX/disk_" | awk '{print $3}'); do
    sudo umount -f -l "$mount" 2>/dev/null || log "Ошибка принудительного размонтирования $mount"
    sleep 1
done

# Создаем директории для конфигурации приложения
CONFIG_DISKS=" disks: {"

# Обрабатываем каждую строку из удаленного fstab
while IFS= read -r line; do
    # Пропускаем комментарии и пустые строки
    if [[ "$line" =~ ^# ]] || [ -z "$line" ]; then
        log "Пропущена строка: $line"
        continue
    fi

    # Разбираем строку fstab
    read -r fs mp type options dump pass <<< "$line"
    log "Обработка строки: fs=$fs, mp=$mp, type=$type, options=$options"

    # Проверяем, является ли точка монтирования подходящей (например, /mnt/disk_*)
    if [[ "$mp" =~ ^${MOUNT_PREFIX}/disk_ ]]; then
        # Извлекаем имя диска из точки монтирования (например, disk_sda_1)
        DISK_NAME=$(basename "$mp")
        LOCAL_MP="$MOUNT_PREFIX/$DISK_NAME"

        # Создаем локальную точку монтирования
        if [ ! -d "$LOCAL_MP" ]; then
            log "Создание точки монтирования $LOCAL_MP"
            sudo mkdir -p "$LOCAL_MP"
            sudo chown "$LOCAL_USER":"$LOCAL_USER" "$LOCAL_MP"
            sudo chmod 775 "$LOCAL_MP"
        fi

        # ВАЖНОЕ ИСПРАВЛЕНИЕ: Преобразуем имя в формат шары Samba на сервере
        # Удаляем префикс disk_ и заменяем _ на пустую строку между буквой и цифрой
        DISK_PART=$(echo "$DISK_NAME" | sed 's/disk_//' | tr '[:lower:]' '[:upper:]')
        # Конвертируем SDA_1 в SDA1 (удаляем подчеркивание между буквой и цифрой)
        SHARE_NAME="DISK_$(echo "$DISK_PART" | sed 's/_//')"
        SAMBA_PATH="//$REMOTE_IP/$SHARE_NAME"
        
        log "Проверка доступности шары $SHARE_NAME..."
        if [ "${AVAILABLE_SHARES[$SHARE_NAME]}" != "1" ]; then
            log "ПРЕДУПРЕЖДЕНИЕ: Шара $SHARE_NAME не найдена в списке доступных шар"
            # Печатаем список всех доступных шар для отладки
            for key in "${!AVAILABLE_SHARES[@]}"; do
                log "  Доступная шара: $key"
            done
        else
            log "Шара $SHARE_NAME присутствует в списке доступных"
        fi

        # Формируем запись для локального fstab с минимальными опциями
        sudo bash -c "echo '$SAMBA_PATH $LOCAL_MP cifs username=$SAMBA_USER,password=$SAMBA_PASS,vers=3.0,_netdev,uid=$(id -u $LOCAL_USER),gid=$(id -g $LOCAL_USER) 0 0 # AUTO-MOUNTED' >> /tmp/fstab.new"

        # Монтируем с минимальными параметрами
        log "Монтирование $SAMBA_PATH на $LOCAL_MP с минимальными параметрами..."
        if ! sudo mount -t cifs "$SAMBA_PATH" "$LOCAL_MP" -o "username=$SAMBA_USER,password=$SAMBA_PASS,vers=3.0,uid=$(id -u $LOCAL_USER),gid=$(id -g $LOCAL_USER)"; then
            log "ОШИБКА: Не удалось смонтировать $SAMBA_PATH на $LOCAL_MP"
            
            # Проверяем подробную информацию о шаре
            log "Повторная проверка доступных шар..."
            smbclient -L "$REMOTE_IP" -U "$SAMBA_USER%$SAMBA_PASS" | grep "$SHARE_NAME" | while IFS= read -r line; do log "  $line"; done
            
            # Пробуем напрямую подключиться к шаре для проверки
            log "Пробуем прямое подключение к шаре $SHARE_NAME..."
            if echo "quit" | smbclient "//$REMOTE_IP/$SHARE_NAME" -U "$SAMBA_USER%$SAMBA_PASS" -c 'ls' 2>/dev/null; then
                log "Шара $SHARE_NAME доступна через smbclient, но монтирование не удалось"
            else
                log "Шара $SHARE_NAME недоступна через smbclient"
            fi
        else
            log "Успешно смонтировано $SAMBA_PATH на $LOCAL_MP"
        fi

        # Добавляем в конфигурацию приложения
        CONFIG_DISKS+="\n '$DISK_NAME': '$LOCAL_MP',"

        log "Добавлен сетевой диск $DISK_NAME: $LOCAL_MP -> $SAMBA_PATH с uid=$LOCAL_USER,gid=$LOCAL_USER"
    else
        log "Пропущена неподходящая точка монтирования: $mp"
    fi
done <<< "$REMOTE_FSTAB_CONTENT"

# Завершаем конфигурацию приложения
CONFIG_DISKS=$(echo -e "$CONFIG_DISKS" | sed '$s/,$//')
CONFIG_DISKS+="\n }"

# Обновляем локальный fstab
sudo mv /tmp/fstab.new $LOCAL_FSTAB
sudo systemctl daemon-reload
log "Файл fstab обновлен"

# Проверяем, смонтированы ли диски
log "Проверка, смонтированы ли диски..."
MOUNT_SUCCESS=0
MOUNT_FAILED=0

for mount in $(grep "$MOUNT_PREFIX/disk_" $LOCAL_FSTAB | awk '{print $2}'); do
    if mountpoint -q "$mount"; then
        log "$mount успешно смонтирован"
        MOUNT_SUCCESS=$((MOUNT_SUCCESS + 1))
    else
        log "ОШИБКА: $mount не смонтирован, пробуем смонтировать вручную..."
        # Извлекаем имя диска из точки монтирования
        DISK_NAME=$(basename "$mount")
        # Преобразуем в формат, понятный для Samba сервера
        DISK_PART=$(echo "$DISK_NAME" | sed 's/disk_//' | tr '[:lower:]' '[:upper:]')
        # Удаляем подчеркивание между буквой и цифрой
        SHARE_NAME="DISK_$(echo "$DISK_PART" | sed 's/_//')"
        SAMBA_PATH="//$REMOTE_IP/$SHARE_NAME"
        
        if sudo mount -t cifs "$SAMBA_PATH" "$mount" -o "username=$SAMBA_USER,password=$SAMBA_PASS,vers=3.0,uid=$(id -u $LOCAL_USER),gid=$(id -g $LOCAL_USER)"; then
            log "Вторая попытка монтирования $mount успешна"
            MOUNT_SUCCESS=$((MOUNT_SUCCESS + 1))
        else
            log "Вторая попытка монтирования $mount не удалась"
            MOUNT_FAILED=$((MOUNT_FAILED + 1))
        fi
    fi
done

# Проверка стабильности соединения
log "Проверка стабильности сетевого соединения..."
if ping -c 5 -w 10 $REMOTE_IP >/dev/null 2>&1; then
    log "Сетевое соединение с $REMOTE_IP стабильно"
else
    log "ПРЕДУПРЕЖДЕНИЕ: Возможны проблемы с сетевым соединением"
fi

# Обновляем конфигурацию веб-приложения
log "Обновление конфигурации веб-приложения..."
if [ -f "$BACKEND_CONFIG" ]; then
    # Создаем резервную копию
    sudo cp "$BACKEND_CONFIG" "$BACKEND_CONFIG.bak"

    # Обновляем секцию disks в конфигурации
    sudo awk -v disks="$CONFIG_DISKS" '
    /disks:/ {
        print disks
        in_disks = 1
        next
    }
    in_disks && /}/ {
        in_disks = 0
        next
    }
    in_disks {
        next
    }
    { print }
    ' "$BACKEND_CONFIG" > /tmp/config.js.new

    sudo mv /tmp/config.js.new "$BACKEND_CONFIG"
    sudo chown "$LOCAL_USER":"$LOCAL_USER" "$BACKEND_CONFIG" 
    log "Конфигурация веб-приложения обновлена"

    # Перезапускаем backend-сервис, если он активен
    if systemctl is-active --quiet backend; then
        log "Перезапуск backend-сервиса..."
        sudo systemctl restart backend
    else
        log "Backend-сервис не найден или не активен"
    fi
else
    log "ОШИБКА: Файл конфигурации $BACKEND_CONFIG не найден"
fi

# Создание простого скрипта для мониторинга и восстановления соединений
log "Создание скрипта для мониторинга CIFS-соединений..."
if [ ! -f "/usr/local/bin/check-cifs.sh" ]; then
    cat > /tmp/check-cifs.sh <<EOL
#!/bin/bash
LOG_FILE="/var/log/cifs-monitor.log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Проверка CIFS-соединений" >> \$LOG_FILE

# Проверяем доступность сервера
if ! ping -c 3 -w 5 192.168.0.104 > /dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Сервер 192.168.0.104 недоступен" >> \$LOG_FILE
    exit 1
fi

# Проверяем каждую точку монтирования
for mount in \$(mount | grep cifs | awk '{print \$3}'); do
    if ! df \$mount > /dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Точка монтирования \$mount недоступна" >> \$LOG_FILE
        
        # Размонтируем принудительно
        umount -f -l \$mount 2>/dev/null
        
        # Пробуем смонтировать заново
        # Извлекаем имя диска из точки монтирования
        DISK_NAME=\$(basename "\$mount")
        # Преобразуем в формат, понятный для Samba сервера
        DISK_PART=\$(echo "\$DISK_NAME" | sed 's/disk_//' | tr '[:lower:]' '[:upper:]')
        # Удаляем подчеркивание между буквой и цифрой
        SHARE_NAME="DISK_\$(echo "\$DISK_PART" | sed 's/_//')"
        
        if mount -t cifs //192.168.0.104/\$SHARE_NAME \$mount -o username=agger,password=2864,vers=3.0,uid=$(id -u apper),gid=$(id -g apper); then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Успешно восстановлено монтирование \$mount" >> \$LOG_FILE
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Не удалось восстановить \$mount" >> \$LOG_FILE
            touch /tmp/sync_trigger
        fi
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Точка монтирования \$mount работает нормально" >> \$LOG_FILE
    fi
done
EOL
    sudo mv /tmp/check-cifs.sh /usr/local/bin/
    sudo chmod +x /usr/local/bin/check-cifs.sh
    
    # Создаем systemd сервис и таймер
    cat > /tmp/cifs-monitor.service <<EOL
[Unit]
Description=Monitor CIFS Connections
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/check-cifs.sh
User=root

[Install]
WantedBy=multi-user.target
EOL
    sudo mv /tmp/cifs-monitor.service /etc/systemd/system/
    
    cat > /tmp/cifs-monitor.timer <<EOL
[Unit]
Description=Run CIFS Monitor Every 5 Minutes
Requires=cifs-monitor.service

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=cifs-monitor.service
Persistent=true

[Install]
WantedBy=timers.target
EOL
    sudo mv /tmp/cifs-monitor.timer /etc/systemd/system/
    
    sudo systemctl daemon-reload
    sudo systemctl enable cifs-monitor.timer
    sudo systemctl start cifs-monitor.timer
    log "Настроен мониторинг CIFS-соединений"
fi

# Итоги работы скрипта
if [ $MOUNT_SUCCESS -gt 0 ]; then
    log "ИТОГ: Успешно смонтировано дисков: $MOUNT_SUCCESS, Не удалось смонтировать: $MOUNT_FAILED"
    log "Синхронизация дисков завершена успешно"
else
    log "ПРЕДУПРЕЖДЕНИЕ: Не удалось смонтировать ни один диск ($MOUNT_FAILED неудачных попыток)"
    log "Синхронизация дисков завершена с ошибками"
fi