#!/bin/bash

# ====================================
# НАСТРОЙКА - ИЗМЕНИТЕ ПАРАМЕТРЫ ЗДЕСЬ
# ====================================

# IP-адреса серверов (укажите ваши серверы)
SERVERS=("192.168.0.102" "192.168.0.106")

# IP-адрес клиента (ваша машина)
CLIENT_IP="192.168.0.103"

# Диски для каждого сервера, которые нужно монтировать
# Формат: "IP-сервера:имя-диска:буква-диска" (без /dev/)
DISKS_TO_MOUNT=(
    "192.168.0.102:sdb:C"
    "192.168.0.102:sdc:D"
    "192.168.0.106:sda:E"
    "192.168.0.106:sdb:F"
)

# Параметры монтирования
MOUNT_OPTIONS="defaults,nofail,noatime,x-systemd.device-timeout=30"
NFS_MOUNT_OPTIONS="vers=3,soft,nolock,rsize=8192,wsize=8192,nofail,noatime,x-systemd.device-timeout=30"

# Базовый каталог для монтирования
MOUNT_BASE="/mnt/data_storage"

# ====================================
# НИЖЕ ЭТОЙ СТРОКИ НИЧЕГО НЕ МЕНЯЙТЕ
# ====================================

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}===== Скрипт настройки NFS с UUID и безопасными параметрами =====${NC}"

# Проверка прав root
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Ошибка: Этот скрипт нужно запускать с правами root${NC}"
    echo "Используйте: sudo $0"
    exit 1
fi

# Запрос паролей в начале выполнения
declare -A SERVER_PASSWORDS
for SERVER in "${SERVERS[@]}"; do
    echo -n "Введите пароль для root@$SERVER: "
    read -s SERVER_PASSWORD
    echo
    SERVER_PASSWORDS[$SERVER]="$SERVER_PASSWORD"
done

# Функция для SSH с сохраненным паролем
ssh_with_password() {
    local server=$1
    local password=${SERVER_PASSWORDS[$server]}
    local command=$2
    
    # Используем sshpass для передачи пароля без запроса
    sshpass -p "$password" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@$server "$command"
    return $?
}

# 1. Сначала размонтируем существующие NFSы
echo -e "${YELLOW}Размонтирование всех NFS-шар...${NC}"
for mount in $(mount | grep -E 'nfs|type nfs' | awk '{print $3}'); do
    echo "Размонтирование $mount..."
    umount -f -l "$mount" 2>/dev/null || true
done

# 2. Обработка каждого сервера
declare -a EXPORTS_TO_MOUNT

for SERVER in "${SERVERS[@]}"; do
    echo -e "${GREEN}===== Настройка сервера $SERVER =====${NC}"
    
    # Проверка доступности сервера
    if ! ping -c 1 -W 1 $SERVER &>/dev/null; then
        echo -e "${RED}Сервер $SERVER недоступен. Пропускаем...${NC}"
        continue
    fi
    
    # Создаем массив дисков для этого сервера
    server_disks=()
    for disk_info in "${DISKS_TO_MOUNT[@]}"; do
        IFS=':' read -r disk_server disk_name disk_letter <<< "$disk_info"
        if [ "$disk_server" == "$SERVER" ]; then
            server_disks+=("$disk_name")
        fi
    done
    
    # Строка с дисками для передачи по SSH
    disks_string=$(printf "'%s' " "${server_disks[@]}")
    
    # SSH команда для настройки сервера
    server_cmd="
    echo \"Проверка физических дисков на сервере $SERVER\"
    lsblk -f
    
    # Перезапуск NFS для чистого состояния
    echo \"Перезапуск NFS сервисов...\"
    systemctl stop nfs-kernel-server rpcbind
    systemctl start rpcbind
    sleep 2
    systemctl start nfs-kernel-server
    
    # Определить, какие диски имеются
    SYSTEM_DISK=\$(df -h / | grep -v Filesystem | awk '{print \$1}' | sed 's/[0-9]//g' | sed 's#/dev/##')
    echo \"Системный диск: \$SYSTEM_DISK\"
    
    # Информация о размерах дисков
    echo \"Размеры дисков:\"
    lsblk -dn -o NAME,SIZE,UUID
    
    # Создать директории для монтирования
    mkdir -p /mnt/storage
    
    # Монтируем только указанные диски
    echo \"Монтирование только указанных дисков: ${server_disks[*]}\"
    
    # Сбросим fstab
    cp /etc/fstab /etc/fstab.backup.\$(date '+%Y%m%d%H%M%S')
    
    # Сохраним только системные монтирования
    grep -E '(^UUID|\s/\s|\sswap\s|^#)' /etc/fstab > /etc/fstab.new
    
    # Добавим комментарий о безопасности
    echo \"# Безопасное монтирование дисков с UUID и опцией nofail\" >> /etc/fstab.new
    
    for DISK in ${disks_string}; do
        # Убираем одинарные кавычки, если они есть
        DISK=\$(echo \$DISK | tr -d \"'\")
        
        echo \"Обработка диска /dev/\$DISK...\"
        
        # Пропускаем системный диск
        if [ \"\$DISK\" == \"\$SYSTEM_DISK\" ]; then
            echo \"ВНИМАНИЕ: \$DISK является системным диском! Пропускаем.\"
            continue
        fi
        
        # Проверяем существование диска
        if [ ! -e \"/dev/\$DISK\" ]; then
            echo \"ОШИБКА: Диск /dev/\$DISK не существует!\"
            continue
        fi
        
        # Создаем точку монтирования
        mkdir -p /mnt/storage/\$DISK
        
        # Размонтируем диск если он уже смонтирован
        if mount | grep -q \"/dev/\$DISK on\"; then
            echo \"Диск /dev/\$DISK уже смонтирован, размонтируем...\"
            umount -f -l /dev/\$DISK 2>/dev/null || true
        fi
        
        # Проверяем UUID диска
        UUID=\$(blkid -s UUID -o value /dev/\$DISK 2>/dev/null)
        FS_TYPE=\$(blkid -o value -s TYPE /dev/\$DISK 2>/dev/null)
        
        if [ -z \"\$FS_TYPE\" ]; then
            echo \"Диск /dev/\$DISK не содержит файловой системы. Создаем XFS...\"
            mkfs.xfs -f /dev/\$DISK
            FS_TYPE=\"xfs\"
            # Получаем UUID повторно
            UUID=\$(blkid -s UUID -o value /dev/\$DISK)
        fi
        
        if [ -z \"\$UUID\" ]; then
            echo \"ОШИБКА: Не удалось получить UUID для диска /dev/\$DISK\"
            continue
        fi
        
        echo \"Монтирование /dev/\$DISK (\$FS_TYPE, UUID=\$UUID) в /mnt/storage/\$DISK\"
        mount -t \$FS_TYPE -o $MOUNT_OPTIONS /dev/\$DISK /mnt/storage/\$DISK
        
        # Проверка монтирования
        if mount | grep -q \"/dev/\$DISK on /mnt/storage/\$DISK\"; then
            echo \"✓ Диск /dev/\$DISK успешно смонтирован\"
            
            # Добавляем запись в новый fstab с UUID
            echo \"UUID=\$UUID /mnt/storage/\$DISK \$FS_TYPE $MOUNT_OPTIONS 0 0\" >> /etc/fstab.new
            
            # Настройка прав доступа
            chmod -R 777 /mnt/storage/\$DISK
        else
            echo \"✗ Ошибка монтирования диска /dev/\$DISK\"
        fi
    done
    
    # Применяем новый fstab
    mv /etc/fstab.new /etc/fstab
    
    # Перезагружаем systemd
    systemctl daemon-reload
    
    # Настройка NFS экспортов
    echo \"Настройка NFS экспортов...\"
    
    # Удаляем все старые экспорты для этого IP
    grep -v \"$CLIENT_IP\" /etc/exports > /tmp/exports.tmp || echo \"# NFS exports\" > /tmp/exports.tmp
    mv /tmp/exports.tmp /etc/exports
    
    # Добавление только указанных дисков в exports
    for DISK in ${disks_string}; do
        # Убираем одинарные кавычки, если они есть
        DISK=\$(echo \$DISK | tr -d \"'\")
        
        if mount | grep -q \"/mnt/storage/\$DISK\"; then
            echo \"/mnt/storage/\$DISK $CLIENT_IP(rw,sync,no_subtree_check,no_root_squash,insecure)\" >> /etc/exports
            echo \"Экспортирован /mnt/storage/\$DISK для клиента $CLIENT_IP\"
        else
            echo \"Диск /mnt/storage/\$DISK не смонтирован, пропускаем экспорт\"
        fi
    done
    
    # Перезапуск NFS
    exportfs -ra
    systemctl restart nfs-kernel-server
    
    # Проверка экспортов
    echo \"Экспорты NFS:\"
    exportfs -v
    
    # Проверка смонтированных дисков с параметрами UUID
    echo \"Смонтированные диски:\"
    df -h | grep \"/mnt/storage\"
    
    # Проверка UUID в fstab
    echo \"UUID в fstab:\"
    grep UUID /etc/fstab
    "
    
    # Выполнение команды на сервере с сохраненным паролем
    if ! ssh_with_password "$SERVER" "$server_cmd"; then
        echo -e "${RED}Ошибка при настройке сервера $SERVER${NC}"
        continue
    fi
    
    # Проверка наличия утилиты showmount
    if ! command -v showmount &> /dev/null; then
        echo "Утилита showmount не установлена. Устанавливаем..."
        apt-get update -qq && apt-get install -y nfs-common
    fi
    
    # Получение списка экспортов с сервера (с клиента)
    echo "Проверка доступных экспортов с сервера $SERVER..."
    sleep 2  # Даем время NFS-серверу инициализироваться
    SERVER_EXPORTS=$(showmount -e $SERVER 2>/dev/null | grep -v "Export list" | awk '{print $1}' || echo "")
    
    if [ -z "$SERVER_EXPORTS" ]; then
        echo -e "${RED}Нет доступных экспортов с сервера $SERVER${NC}"
        continue
    fi
    
    # Добавляем экспорты в массив для последующего монтирования
    for EXPORT in $SERVER_EXPORTS; do
        DISK_NAME=$(basename $EXPORT)
        
        # Проверяем, есть ли этот диск в списке для монтирования
        disk_found=false
        for disk_info in "${DISKS_TO_MOUNT[@]}"; do
            IFS=':' read -r disk_server disk_name disk_letter <<< "$disk_info"
            if [ "$disk_server" == "$SERVER" ] && [ "$disk_name" == "$DISK_NAME" ]; then
                disk_found=true
                EXPORTS_TO_MOUNT+=("$SERVER:$EXPORT:$disk_letter")
                break
            fi
        done
        
        if [ "$disk_found" = false ]; then
            echo -e "${YELLOW}Диск $DISK_NAME не указан в конфигурации для сервера $SERVER. Пропускаем...${NC}"
        fi
    done
    
    echo -e "${GREEN}Найдены следующие экспорты на сервере $SERVER:${NC}"
    echo "$SERVER_EXPORTS"
done

# 3. Монтирование всех найденных NFS экспортов на клиенте
echo -e "${YELLOW}Монтирование NFS шар на клиенте...${NC}"

# Очистка fstab от старых записей
cp /etc/fstab /etc/fstab.backup_$(date +"%Y%m%d%H%M%S")
grep -v "$MOUNT_BASE" /etc/fstab > /tmp/fstab.new
cp /tmp/fstab.new /etc/fstab

# Добавляем комментарий о NFS монтированиях
echo "# NFS монтирования с опцией nofail для безопасной загрузки" >> /etc/fstab

# Монтирование каждого экспорта
for EXPORT_ENTRY in "${EXPORTS_TO_MOUNT[@]}"; do
    IFS=':' read -r SERVER_IP EXPORT_PATH LETTER <<< "$EXPORT_ENTRY"
    DISK_NAME=$(basename $EXPORT_PATH)
    MOUNT_POINT="$MOUNT_BASE/$SERVER_IP/$DISK_NAME"
    
    # Создание точки монтирования
    mkdir -p $MOUNT_POINT
    
    # Размонтирование, если уже смонтировано
    if mount | grep -q " on $MOUNT_POINT "; then
        echo "Размонтирование существующего $MOUNT_POINT..."
        umount -f -l $MOUNT_POINT 2>/dev/null || true
    fi
    
    # Монтирование
    echo "Монтирование $SERVER_IP:$EXPORT_PATH в $MOUNT_POINT (Буква: $LETTER)"
    mount -t nfs -o $NFS_MOUNT_OPTIONS $SERVER_IP:$EXPORT_PATH $MOUNT_POINT
    
    if mount | grep -q " on $MOUNT_POINT "; then
        echo -e "${GREEN}✓ Успешно смонтирован $EXPORT_PATH с сервера $SERVER_IP (Буква: $LETTER)${NC}"
        # Добавление в fstab
        echo "$SERVER_IP:$EXPORT_PATH $MOUNT_POINT nfs $NFS_MOUNT_OPTIONS 0 0" >> /etc/fstab
    else
        echo -e "${RED}✗ Ошибка монтирования $EXPORT_PATH с сервера $SERVER_IP${NC}"
    fi
    
    # Проверка реального размера диска
    DF_SIZE=$(df -h $MOUNT_POINT | grep -v "Filesystem" | awk '{print $2}')
    DF_USED=$(df -h $MOUNT_POINT | grep -v "Filesystem" | awk '{print $3}')
    DF_AVAIL=$(df -h $MOUNT_POINT | grep -v "Filesystem" | awk '{print $4}')
    echo "Диск $LETTER: Размер=$DF_SIZE, Использовано=$DF_USED, Доступно=$DF_AVAIL"
done

# 4. Обновление конфигурации backend
echo -e "${YELLOW}Обновление конфигурации backend...${NC}"
CONFIG_PATH="../backend/config/config.js"

if [ -f "$CONFIG_PATH" ]; then
    echo "Найден файл конфигурации backend: $CONFIG_PATH"
    
    # Создание резервной копии
    cp "$CONFIG_PATH" "${CONFIG_PATH}.bak_$(date +"%Y%m%d%H%M%S")"
    
    # Создаем строки для конфигурации дисков
    DISKS_CONFIG=""
    for EXPORT_ENTRY in "${EXPORTS_TO_MOUNT[@]}"; do
        IFS=':' read -r SERVER_IP EXPORT_PATH LETTER <<< "$EXPORT_ENTRY"
        DISK_NAME=$(basename $EXPORT_PATH)
        MOUNT_POINT="$MOUNT_BASE/$SERVER_IP/$DISK_NAME"
        
        # Добавляем диск в конфигурацию если он смонтирован
        if mount | grep -q " on $MOUNT_POINT "; then
            DISKS_CONFIG="${DISKS_CONFIG}            '$LETTER:': '$MOUNT_POINT',\n"
        fi
    done
    
    # Удаляем запятую с последней строки
    DISKS_CONFIG=$(echo -e "$DISKS_CONFIG" | sed '$ s/,$//')
    
# Создаем новый конфигурационный файл
cat > "$CONFIG_PATH" << EOF
// Конфигурация приложения
const config = {
  // Базовые настройки
  server: {
    port: process.env.PORT || 6005,
    allowedOrigins: [
      'http://46.35.241.37:6001', 
      'http://localhost:6001',
      'https://iqbanana.online',
      'http://iqbanana.online'
    ]
  },
  
  // Версия API
  apiVersion: 'v1',
  
  // Пути к смонтированным дискам на веб-сервере
  disks: {
$(echo -e "$DISKS_CONFIG")
  },
  
  // Настройки производительности для файловых операций
  performance: {
    maxFileSize: 20 * 1024 * 1024 * 1024, // 20GB максимальный размер файла
    chunkSize: 5 * 1024 * 1024, // 5MB размер чанка по умолчанию для больших файлов
    maxConcurrentUploads: 5, // Максимальное количество одновременных загрузок
    uploadTimeout: 3600000, // 1 час таймаут для загрузки полного файла
    chunkTimeout: 600000, // 10 минут таймаут для загрузки чанка
    readBufferSize: 4096 * 1024, // 4 MB буфер для чтения файлов
    writeBufferSize: 8192 * 1024 // 8 MB буфер для записи файлов
  }
};

module.exports = config;
EOF
    
    echo -e "${GREEN}✓ Конфигурация backend обновлена успешно${NC}"
    echo "Содержимое конфигурации дисков:"
    grep -A 10 "disks: {" "$CONFIG_PATH"
else
    echo -e "${YELLOW}⚠️ Файл конфигурации backend не найден: $CONFIG_PATH${NC}"
fi

# 5. Вывод итоговой информации
echo -e "\n${GREEN}===== Настройка завершена! =====${NC}"
echo -e "${YELLOW}Текущие монтирования:${NC}"
df -h | grep -E "storage|nfs"

# Вывод содержимого fstab для проверки
echo -e "\n${YELLOW}Содержимое обновленного /etc/fstab:${NC}"
cat /etc/fstab | grep -v "^#" | grep -v "^$"

echo -e "\n${GREEN}Для сохранения изменений рекомендуется перезагрузить систему${NC}"