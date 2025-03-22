#!/bin/bash
# Скрипт для ручного монтирования NFS дисков на клиенте (apper)

# Настройки
REMOTE_IP="192.168.0.104"
MOUNT_PREFIX="/mnt"
LOG_FILE="/var/log/mount-nfs-manual.log"
MOUNT_TIMEOUT=30  # Таймаут монтирования в секундах

# Проверяем, запущен ли с sudo или от root
if [ "$(id -u)" -ne 0 ]; then
    echo "Этот скрипт нужно запускать с sudo или от имени root"
    exit 1
fi

# Функция для логирования
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

echo "=== Скрипт для ручного монтирования NFS дисков ==="

# Создаём лог-файл с правильными правами, если его нет
mkdir -p /var/log
touch "$LOG_FILE"
chown apper:apper "$LOG_FILE"
chmod 644 "$LOG_FILE"

# Проверка основных утилит
log "Проверка необходимых утилит..."
for cmd in mount showmount rpcinfo; do
    if ! which $cmd > /dev/null 2>&1; then
        log "ОШИБКА: Команда $cmd не найдена. Установите nfs-common"
        apt update && apt install -y nfs-common
        break
    fi
done

# Перезапуск всех связанных служб
log "Перезапуск служб NFS клиента..."
systemctl restart rpcbind
sleep 2

# Проверка сетевых настроек
log "Проверка сетевых настроек..."
ip a | grep -w inet | tee -a "$LOG_FILE"

# Проверка доступности NFS сервера
log "Проверка доступности NFS сервера $REMOTE_IP..."
if ! ping -c 3 -w 5 $REMOTE_IP >/dev/null 2>&1; then
    log "ОШИБКА: Сервер $REMOTE_IP недоступен"
    log "Трассировка маршрута до $REMOTE_IP:"
    traceroute -n $REMOTE_IP | tee -a "$LOG_FILE"
    exit 1
fi

# Проверка портов NFS
log "Проверка портов NFS на сервере $REMOTE_IP..."
rpcinfo -p $REMOTE_IP | tee -a "$LOG_FILE"

# Получение списка экспортируемых NFS ресурсов с таймаутом
log "Получение списка NFS ресурсов с сервера $REMOTE_IP (таймаут 10 секунд)..."
REMOTE_EXPORTS=$(timeout 10 showmount -e $REMOTE_IP 2>/dev/null | grep -v "Export list" | awk '{print $1}')

if [ -z "$REMOTE_EXPORTS" ]; then
    log "ОШИБКА: Не удалось получить список NFS ресурсов с сервера $REMOTE_IP"
    log "Попробуем получить список напрямую..."
    
    # Заранее заданный список, если showmount не работает
    REMOTE_EXPORTS="/mnt/disk_sdb1
/mnt/disk_sdb5
/mnt/disk_sda1
/mnt/disk_sdc1"
    
    log "Используем предопределенный список экспортов."
fi

# Логируем список доступных ресурсов
log "Будем монтировать следующие NFS ресурсы:"
echo "$REMOTE_EXPORTS" | while IFS= read -r line; do log "  $line"; done

# Очищаем существующие точки монтирования NFS
log "Размонтирование существующих NFS точек..."
for mount in $(mount | grep "type nfs" | grep "$MOUNT_PREFIX/disk_" | awk '{print $3}'); do
    log "Размонтирование $mount..."
    umount -f -l "$mount" 2>/dev/null || log "Ошибка размонтирования $mount"
    sleep 1
done

# Обрабатываем каждый NFS экспорт
while IFS= read -r remote_export; do
    # Пропускаем пустые строки
    [ -z "$remote_export" ] && continue
    
    disk_name=$(basename "$remote_export")
    local_mount="$MOUNT_PREFIX/$disk_name"
    
    # Создаем локальную точку монтирования
    if [ ! -d "$local_mount" ]; then
        log "Создание точки монтирования $local_mount"
        mkdir -p "$local_mount"
        chown apper:apper "$local_mount"
        chmod 755 "$local_mount"
    fi
    
    # Проверка, есть ли уже что-то смонтированное в этой точке
    if mount | grep -q " $local_mount "; then
        log "Точка $local_mount уже занята, размонтируем..."
        umount -f -l "$local_mount" 2>/dev/null
        sleep 1
    fi
    
    # Монтируем NFS с оптимальными параметрами и таймаутом
    log "Монтирование $remote_export на $local_mount..."
    timeout $MOUNT_TIMEOUT mount -t nfs -o rw,vers=3,rsize=32768,wsize=32768,noatime,soft,timeo=600,retrans=2 $REMOTE_IP:$remote_export $local_mount
    
    if [ $? -eq 0 ]; then
        log "Успешно смонтирован $remote_export на $local_mount через NFS"
    else
        log "ОШИБКА: Не удалось смонтировать $remote_export через NFS (таймаут $MOUNT_TIMEOUT сек)"
        
        # Пробуем альтернативные параметры
        log "Попытка монтирования с альтернативными параметрами (таймаут 10 сек)..."
        timeout 10 mount -t nfs -o rw,vers=3,soft,intr $REMOTE_IP:$remote_export $local_mount
        
        if [ $? -eq 0 ]; then
            log "Успешно смонтирован $remote_export с альтернативными параметрами"
        else
            log "ОШИБКА: Все попытки монтирования $remote_export неудачны"
            
            # Проверка файрвола
            log "Проверка файрвола..."
            iptables -L | grep -i nfs | tee -a "$LOG_FILE"
        fi
    fi
done <<< "$REMOTE_EXPORTS"

# Проверка смонтированных NFS ресурсов
mount_count=$(mount | grep "type nfs" | grep "$MOUNT_PREFIX/disk_" | wc -l)
log "Успешно смонтировано $mount_count NFS ресурсов"

# Выводим список смонтированных точек
log "Список смонтированных NFS разделов:"
mount | grep "type nfs" | tee -a "$LOG_FILE"

# Проверяем, есть ли проблемы с NFS
nfs_issues=$(dmesg | grep -i "nfs" | tail -10)
if [ -n "$nfs_issues" ]; then
    log "Обнаружены сообщения ядра о NFS:"
    echo "$nfs_issues" | while IFS= read -r line; do log "  $line"; done
fi

echo -e "\n=== Готово ==="
echo "Проверьте смонтированные NFS разделы с помощью команды 'mount | grep nfs'"
echo "Журнал операций доступен в файле $LOG_FILE" 