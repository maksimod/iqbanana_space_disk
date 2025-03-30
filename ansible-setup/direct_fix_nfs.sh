#!/bin/bash

# Скрипт для прямого исправления NFS-экспортов на серверах

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}===== Скрипт прямого исправления NFS-экспортов =====${NC}"

# Проверка прав root
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Ошибка: Этот скрипт нужно запускать с правами root${NC}"
    echo "Используйте: sudo $0"
    exit 1
fi

# 1. Сначала размонтируем существующие NFSы
echo -e "${YELLOW}Размонтирование всех NFS-шар...${NC}"
for mount in $(mount | grep -E 'nfs|type nfs' | awk '{print $3}'); do
    echo "Размонтирование $mount..."
    umount -f -l "$mount" 2>/dev/null || true
done

# 2. Обработка каждого сервера
SERVERS=("192.168.0.102" "192.168.0.106")

for SERVER in "${SERVERS[@]}"; do
    echo -e "${GREEN}===== Настройка сервера $SERVER =====${NC}"
    
    # SSH на сервер для фиксации монтирования дисков
    ssh -o StrictHostKeyChecking=no root@$SERVER << EOF
    echo "Проверка физических дисков на сервере $SERVER"
    lsblk -f
    
    # Остановить NFS сервер
    systemctl stop nfs-kernel-server
    
    # Размонтировать все в /mnt/storage
    umount -f -l /mnt/storage/* 2>/dev/null || true
    
    # Создать директории для монтирования
    mkdir -p /mnt/storage/sda
    mkdir -p /mnt/storage/sdb
    mkdir -p /mnt/storage/sdc
    
    # Определить, какие диски имеются
    SYSTEM_DISK=\$(df -h / | grep -v Filesystem | awk '{print \$1}' | sed 's/[0-9]//g' | sed 's#/dev/##')
    echo "Системный диск: \$SYSTEM_DISK"
    
    # Найти все доступные физические диски
    DISKS=\$(lsblk -dn -o NAME | grep -v loop | grep -v sr | grep -v ram)
    
    # Монтируем несистемные диски
    for DISK in \$DISKS; do
        # Пропускаем системный диск
        if [ "\$DISK" == "\$SYSTEM_DISK" ]; then
            echo "Пропускаем системный диск \$DISK"
            continue
        fi
        
        # Проверяем файловую систему
        FS_TYPE=\$(blkid -o value -s TYPE /dev/\$DISK 2>/dev/null)
        
        if [ -z "\$FS_TYPE" ]; then
            echo "✓ Создаем XFS файловую систему на диске /dev/\$DISK"
            mkfs.xfs -f /dev/\$DISK
            FS_TYPE="xfs"
        fi
        
        echo "Монтирование /dev/\$DISK (\$FS_TYPE) в /mnt/storage/\$DISK"
        mount -t \$FS_TYPE /dev/\$DISK /mnt/storage/\$DISK
        
        # Проверка монтирования
        if mount | grep -q "/dev/\$DISK on /mnt/storage/\$DISK"; then
            echo "✓ Диск /dev/\$DISK успешно смонтирован"
            
            # Обновляем fstab
            if ! grep -q "/dev/\$DISK" /etc/fstab; then
                echo "/dev/\$DISK /mnt/storage/\$DISK \$FS_TYPE defaults 0 0" >> /etc/fstab
            fi
            
            # Настройка прав доступа
            chmod 777 /mnt/storage/\$DISK
        else
            echo "✗ Ошибка монтирования диска /dev/\$DISK"
        fi
    done
    
    # Проверка и настройка экспортов NFS
    echo "Настройка NFS экспортов..."
    
    # Создание правильного exports файла
    cat > /etc/exports << EXPORTS
# NFS exports - прямая настройка
# Автоматически сгенерировано скриптом direct_fix_nfs.sh

EXPORTS
    
    # Добавление несистемных дисков в exports
    for DISK in \$DISKS; do
        if [ "\$DISK" != "\$SYSTEM_DISK" ] && mount | grep -q "/mnt/storage/\$DISK"; then
            echo "/mnt/storage/\$DISK 192.168.0.103(rw,sync,no_subtree_check,no_root_squash,insecure)" >> /etc/exports
        fi
    done
    
    # Перезапуск NFS
    exportfs -ra
    systemctl restart nfs-kernel-server
    
    # Проверка экспортов
    echo "Экспорты NFS:"
    exportfs -v
    
    # Проверка смонтированных дисков
    echo "Смонтированные диски:"
    df -h | grep "/mnt/storage"
EOF

    # Проверка результата
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Настройка сервера $SERVER успешно завершена${NC}"
    else
        echo -e "${RED}✗ Ошибка при настройке сервера $SERVER${NC}"
    fi
done

# 3. Монтирование NFS на клиенте
echo -e "${YELLOW}Монтирование NFS шар на клиенте...${NC}"

# Очистка fstab от старых записей
cp /etc/fstab /etc/fstab.backup_$(date +"%Y%m%d%H%M%S")
grep -v "192.168.0.10[26]:/mnt/storage" /etc/fstab > /tmp/fstab.new
cp /tmp/fstab.new /etc/fstab

# Создание точек монтирования
for SERVER in "${SERVERS[@]}"; do
    # Проверка сервера
    echo "Проверка экспортов сервера $SERVER"
    EXPORTS=$(showmount -e $SERVER 2>/dev/null | grep -v "Export list" | awk '{print $1}')
    
    if [ -z "$EXPORTS" ]; then
        echo -e "${RED}Нет доступных экспортов на сервере $SERVER${NC}"
        continue
    fi
    
    # Монтирование каждого экспорта
    for EXPORT in $EXPORTS; do
        DISK_NAME=$(basename $EXPORT)
        MOUNT_POINT="/mnt/data_storage/$SERVER/$DISK_NAME"
        
        # Создание точки монтирования
        mkdir -p $MOUNT_POINT
        
        # Монтирование
        echo "Монтирование $SERVER:$EXPORT в $MOUNT_POINT"
        mount -t nfs -o vers=3,soft,nolock,rsize=8192,wsize=8192 $SERVER:$EXPORT $MOUNT_POINT
        
        if mount | grep -q "$MOUNT_POINT"; then
            echo -e "${GREEN}✓ Успешно смонтирован $EXPORT с сервера $SERVER${NC}"
            # Добавление в fstab
            echo "$SERVER:$EXPORT $MOUNT_POINT nfs vers=3,soft,nolock,rsize=8192,wsize=8192,nofail 0 0" >> /etc/fstab
        else
            echo -e "${RED}✗ Ошибка монтирования $EXPORT с сервера $SERVER${NC}"
        fi
    done
done

# 4. Вывод итоговой информации
echo -e "\n${GREEN}===== Настройка завершена! =====${NC}"
echo -e "${YELLOW}Текущие монтирования:${NC}"
df -h | grep nfs

# Вывод содержимого fstab для проверки
echo -e "\n${YELLOW}Содержимое обновленного /etc/fstab:${NC}"
cat /etc/fstab

echo -e "\n${GREEN}Для сохранения изменений рекомендуется перезагрузить систему${NC}"