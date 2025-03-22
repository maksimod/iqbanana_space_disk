#!/bin/bash
# Скрипт для ручного монтирования NTFS дисков на сервере agger
# Автор: Claude 3.7 Sonnet

echo "============================================="
echo "     Монтирование NTFS дисков на сервере"
echo "============================================="

# Проверка на запуск от root
if [[ $EUID -ne 0 ]]; then
    echo "Этот скрипт должен быть запущен с правами root" 
    echo "Пожалуйста, запустите: sudo $0"
    exit 1
fi

# Поиск всех дисков с файловой системой NTFS
echo "Поиск NTFS дисков..."
NTFS_DISKS=$(lsblk -no NAME,FSTYPE | grep ntfs | awk '{print $1}')

if [[ -z "$NTFS_DISKS" ]]; then
    echo "NTFS диски не найдены."
    exit 0
fi

# Обработка каждого NTFS диска
for disk in $NTFS_DISKS; do
    echo "---------------------------------------------"
    echo "Обработка NTFS диска: /dev/$disk"
    
    # Создание точки монтирования
    MOUNT_POINT="/mnt/disk_$disk"
    if [[ ! -d "$MOUNT_POINT" ]]; then
        echo "Создание точки монтирования $MOUNT_POINT..."
        mkdir -p "$MOUNT_POINT"
        chmod 755 "$MOUNT_POINT"
    fi
    
    # Проверка, смонтирован ли уже диск
    if mount | grep -q "/dev/$disk"; then
        echo "Диск /dev/$disk уже смонтирован. Размонтирование..."
        umount -f "/dev/$disk" 2>/dev/null || umount -l "/dev/$disk" 2>/dev/null
    fi
    
    # Монтирование диска с правильными параметрами
    echo "Монтирование /dev/$disk в $MOUNT_POINT..."
    
    # Выполняем монтирование с ntfs-3g для поддержки прав доступа
    if ntfs-3g -o permissions,allow_other,uid=apper,gid=apper,umask=000 "/dev/$disk" "$MOUNT_POINT"; then
        echo "Диск /dev/$disk успешно смонтирован в $MOUNT_POINT"
        
        # Настройка прав доступа
        chown apper:apper "$MOUNT_POINT"
        chmod 777 "$MOUNT_POINT"
        
        # Добавление записи в /etc/fstab если её нет
        if ! grep -q "/dev/$disk" /etc/fstab; then
            echo "Добавление записи в /etc/fstab..."
            echo "/dev/$disk $MOUNT_POINT ntfs-3g permissions,allow_other,uid=apper,gid=apper,umask=000 0 0" >> /etc/fstab
        fi
    else
        echo "ОШИБКА: Не удалось смонтировать /dev/$disk"
    fi
done

echo "---------------------------------------------"
echo "Текущие смонтированные диски:"
df -h | grep "/mnt/disk_"
echo "---------------------------------------------"

echo "Перезапуск сервиса NFS для обновления экспортов..."
systemctl restart nfs-kernel-server
exportfs -rav

echo "============================================="
echo "     Монтирование NTFS дисков завершено     "
echo "============================================="

exit 0 