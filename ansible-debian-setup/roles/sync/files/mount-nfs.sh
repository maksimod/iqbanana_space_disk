#!/bin/bash

# Настройки
REMOTE_IP="192.168.0.104"
MOUNT_PREFIX="/mnt"
LOG_FILE="/var/log/mount-nfs.log"
RETRY_COUNT=10
RETRY_DELAY=3
FORCE_MODE=false
AUTO_DISCOVER=true
BACKEND_CONFIG="/home/apper/iqbanana-disk/backend/config/config.js"

# Проверка аргументов
for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
        --no-auto-discover)
            AUTO_DISCOVER=false
            ;;
        --help)
            echo "Использование: $0 [--force] [--no-auto-discover] [--help]"
            echo "  --force: Принудительное перемонтирование всех точек"
            echo "  --no-auto-discover: Не выполнять автоматическое обнаружение доступных дисков"
            echo "  --help: Показать эту справку"
            exit 0
            ;;
    esac
done

# Создаём лог-файл с правильными правами, если его нет
mkdir -p /var/log
touch "$LOG_FILE"
chown apper:apper "$LOG_FILE"
chmod 644 "$LOG_FILE"

# Функция для логирования
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Запуск скрипта монтирования NFS"

# Проверка наличия необходимых пакетов
if ! command -v showmount &> /dev/null || ! command -v mount.nfs &> /dev/null; then
    log "ОШИБКА: Пакеты NFS не установлены. Устанавливаем..."
    apt-get update && apt-get install -y nfs-common rpcbind
    systemctl start rpcbind
    systemctl enable rpcbind
fi

# Проверка и запуск необходимых сервисов
if ! systemctl is-active --quiet rpcbind; then
    log "Сервис rpcbind не запущен. Запускаем..."
    systemctl start rpcbind
fi

# Проверка доступности NFS сервера
log "Проверка доступности сервера $REMOTE_IP..."
server_available=false
for i in $(seq 1 $RETRY_COUNT); do
    if ping -c 1 -W 2 $REMOTE_IP >/dev/null 2>&1; then
        log "Сервер $REMOTE_IP доступен!"
        server_available=true
        break
    else
        log "Попытка $i: Сервер $REMOTE_IP не отвечает. Повторная попытка через $RETRY_DELAY секунды..."
        sleep $RETRY_DELAY
    fi
done

if [ "$server_available" = false ]; then
    log "ОШИБКА: Сервер $REMOTE_IP недоступен после $RETRY_COUNT попыток."
    exit 1
fi

# Проверка доступности RPC и NFS портов
for port in 111 2049; do
    port_name="RPC"
    [ $port -eq 2049 ] && port_name="NFS"
    
    log "Проверка доступности порта $port_name ($port)..."
    port_available=false
    
    for i in $(seq 1 $RETRY_COUNT); do
        if timeout 3 bash -c "echo > /dev/tcp/$REMOTE_IP/$port" >/dev/null 2>&1; then
            log "Порт $port_name доступен!"
            port_available=true
            break
        else
            log "Попытка $i: Порт $port_name недоступен. Повторная попытка через $RETRY_DELAY секунды..."
            sleep $RETRY_DELAY
        fi
    done
    
    if [ "$port_available" = false ]; then
        log "ОШИБКА: Порт $port_name недоступен после $RETRY_COUNT попыток."
        exit 1
    fi
done

# Получение списка экспортов NFS
if [ "$AUTO_DISCOVER" = true ]; then
    log "Получение списка NFS экспортов (автоматическое обнаружение)..."
    exports=()
    success=false

    for i in $(seq 1 $RETRY_COUNT); do
        if output=$(showmount -e $REMOTE_IP 2>/dev/null); then
            while read -r line; do
                if [[ "$line" != "Export list for"* ]]; then
                    export_path=$(echo "$line" | awk '{print $1}')
                    if [[ "$export_path" == /mnt/disk_* ]]; then
                        exports+=("$export_path")
                    fi
                fi
            done <<< "$output"
            
            if [ ${#exports[@]} -gt 0 ]; then
                success=true
                break
            else
                log "Попытка $i: Не найдено подходящих экспортов. Повторная попытка..."
                sleep $RETRY_DELAY
            fi
        else
            log "Попытка $i: Не удалось получить список экспортов. Повторная попытка через $RETRY_DELAY секунды..."
            sleep $RETRY_DELAY
        fi
    done
else
    log "Автоматическое обнаружение отключено. Проверка имеющихся монтирований..."
    success=false
fi

# Если не удалось получить список экспортов или автоматическое обнаружение отключено
if [ "$success" = false ] || [ ${#exports[@]} -eq 0 ]; then
    log "Получение списка из fstab..."
    while read -r line; do
        if [[ "$line" == *"$REMOTE_IP:/mnt/disk_"* && "$line" == *"nfs"* ]]; then
            remote_path=$(echo "$line" | awk '{print $1}')
            exports+=("$remote_path")
        fi
    done < /etc/fstab
    
    # Если и в fstab нет данных, проверяем на сервере все возможные стандартные пути
    if [ ${#exports[@]} -eq 0 ]; then
        log "Проверка наличия стандартных путей на сервере..."
        # Перебираем все возможные имена дисков sda-sdz и sda1-sdz9
        for letter in {a..z}; do
            for num in {1..9}; do
                path="/mnt/disk_sd${letter}${num}"
                if ssh -o ConnectTimeout=2 -o BatchMode=yes -o StrictHostKeyChecking=no $REMOTE_IP "[ -d $path ]" 2>/dev/null; then
                    exports+=("$path")
                    log "Обнаружен путь: $path"
                fi
            done
            path="/mnt/disk_sd${letter}"
            if ssh -o ConnectTimeout=2 -o BatchMode=yes -o StrictHostKeyChecking=no $REMOTE_IP "[ -d $path ]" 2>/dev/null; then
                exports+=("$path")
                log "Обнаружен путь: $path"
            fi
        done
    fi
    
    # Если все равно не нашли ни одного диска, используем стандартный набор
    if [ ${#exports[@]} -eq 0 ]; then
        log "Не удалось найти ни одного диска. Использую стандартный набор для проверки..."
        for disk in sda1 sdb1 sdb5 sdc1 sdd1; do
            exports+=("/mnt/disk_$disk")
        done
    fi
fi

# Отображение найденных экспортов
log "Найдено ${#exports[@]} NFS экспортов:"
for export_path in "${exports[@]}"; do
    log "  - $export_path"
done

# Функция для очистки устаревших монтирований
clean_stale_mounts() {
    log "=== Очистка устаревших NFS монтирований ==="
    
    # Создаем массив с актуальными экспортами
    local actual_exports=()
    for export_path in "${exports[@]}"; do
        # Убираем префикс сервера, если он есть
        if [[ "$export_path" == "$REMOTE_IP:"* ]]; then
            export_path="${export_path#$REMOTE_IP:}"
        fi
        actual_exports+=("$export_path")
    done
    
    # Получаем список всех NFS монтирований в fstab
    local fstab_mounts=()
    while read -r line; do
        if [[ "$line" == *"$REMOTE_IP:/mnt/disk_"* && "$line" == *"nfs"* ]]; then
            mount_entry=$(echo "$line" | awk '{print $1}')
            # Убираем префикс сервера
            mount_path="${mount_entry#$REMOTE_IP:}"
            fstab_mounts+=("$mount_path")
        fi
    done < /etc/fstab
    
    # Проверяем каждую запись в fstab и удаляем неактуальные
    for fstab_path in "${fstab_mounts[@]}"; do
        local is_valid=false
        
        for actual_path in "${actual_exports[@]}"; do
            if [ "$fstab_path" = "$actual_path" ]; then
                is_valid=true
                break
            fi
        done
        
        if [ "$is_valid" = false ]; then
            log "Удаление устаревшей записи: $REMOTE_IP:$fstab_path"
            
            # Получаем точку монтирования
            mount_point="$MOUNT_PREFIX/$(basename "$fstab_path")"
            
            # Размонтируем, если смонтировано
            if mountpoint -q "$mount_point"; then
                log "Размонтирование $mount_point..."
                umount -f "$mount_point" 2>/dev/null || umount -l "$mount_point" 2>/dev/null
            fi
            
            # Удаляем из fstab
            sed -i "\|$REMOTE_IP:$fstab_path|d" /etc/fstab
            log "Запись удалена из fstab"
        fi
    done
    
    log "Очистка устаревших монтирований завершена"
}

# Создаем резервную копию /etc/fstab перед изменениями
if [ ! -f "/etc/fstab.backup" ]; then
    log "Создание резервной копии /etc/fstab..."
    cp /etc/fstab /etc/fstab.backup
fi

# Очистка устаревших монтирований
clean_stale_mounts

# Перебор экспортов и их монтирование
mounted_count=0
failed_count=0

for export_path in "${exports[@]}"; do
    # Если путь уже содержит адрес сервера, удаляем его
    if [[ "$export_path" == "$REMOTE_IP:"* ]]; then
        export_path="${export_path#$REMOTE_IP:}"
    fi
    
    # Создаем локальную точку монтирования с тем же именем
    dir_name=$(basename "$export_path")
    mount_point="$MOUNT_PREFIX/$dir_name"
    
    # Создаем директорию, если она не существует
    if [ ! -d "$mount_point" ]; then
        log "Создание директории $mount_point..."
        mkdir -p "$mount_point"
        chmod 777 "$mount_point"
    fi
    
    # Проверяем, смонтирован ли уже этот экспорт и доступен ли он
    if mountpoint -q "$mount_point"; then
        if timeout 2 ls -la "$mount_point" >/dev/null 2>&1; then
            if [ "$FORCE_MODE" = true ]; then
                log "Принудительное перемонтирование $mount_point..."
                umount -f "$mount_point" 2>/dev/null || umount -l "$mount_point" 2>/dev/null
            else
                log "Точка $mount_point уже смонтирована и доступна. Пропускаем."
                mounted_count=$((mounted_count + 1))
                continue
            fi
        else
            log "Точка $mount_point смонтирована, но не отвечает. Размонтирование..."
            umount -f "$mount_point" 2>/dev/null || umount -l "$mount_point" 2>/dev/null
        fi
    fi
    
    # Монтирование NFS экспорта
    log "Монтирование $REMOTE_IP:$export_path в $mount_point..."
    mount_success=false
    
    for i in $(seq 1 3); do
        if mount -t nfs -o rw,hard,timeo=600,retrans=3,proto=tcp,noatime $REMOTE_IP:$export_path $mount_point; then
            log "Успешно смонтировано $mount_point"
            mount_success=true
            
            # Добавляем в /etc/fstab, если нет такой записи
            if ! grep -q "$REMOTE_IP:$export_path $mount_point" /etc/fstab; then
                log "Добавление записи в /etc/fstab для автоматического монтирования..."
                echo "$REMOTE_IP:$export_path $mount_point nfs rw,hard,timeo=600,retrans=3,proto=tcp,noatime 0 0" >> /etc/fstab
                log "Запись добавлена в /etc/fstab"
            fi
            
            mounted_count=$((mounted_count + 1))
            break
        else
            log "Попытка $i: Не удалось смонтировать $REMOTE_IP:$export_path. Повторная попытка..."
            sleep 2
        fi
    done
    
    if [ "$mount_success" = false ]; then
        log "ОШИБКА: Не удалось смонтировать $REMOTE_IP:$export_path в $mount_point после 3 попыток"
        failed_count=$((failed_count + 1))
    fi
done

log "Монтирование NFS завершено: успешно - $mounted_count, с ошибками - $failed_count"

# Проверка смонтированных разделов
log "Проверка доступности смонтированных разделов:"
for export_path in "${exports[@]}"; do
    # Если путь уже содержит адрес сервера, удаляем его
    if [[ "$export_path" == "$REMOTE_IP:"* ]]; then
        export_path="${export_path#$REMOTE_IP:}"
    fi
    
    dir_name=$(basename "$export_path")
    mount_point="$MOUNT_PREFIX/$dir_name"
    
    if mountpoint -q "$mount_point"; then
        if timeout 2 ls -la "$mount_point" >/dev/null 2>&1; then
            log "  - $mount_point: успешно смонтирован и доступен"
        else
            log "  - $mount_point: смонтирован, но НЕ ДОСТУПЕН"
        fi
    else
        log "  - $mount_point: НЕ СМОНТИРОВАН"
    fi
done

# Обновляем конфигурацию веб-приложения
log "Обновление конфигурации веб-приложения..."
if [ -f "$BACKEND_CONFIG" ]; then
    # Пока просто логируем наличие файла конфигурации
    log "Файл конфигурации $BACKEND_CONFIG найден"
fi

# Завершение скрипта
log "Скрипт монтирования NFS успешно завершен"
exit 0 