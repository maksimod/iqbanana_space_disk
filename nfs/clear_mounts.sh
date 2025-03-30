#!/bin/bash

# Скрипт для безопасного размонтирования всех несистемных дисков и очистки fstab

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Режим защиты данных по умолчанию ВКЛЮЧЕН
DATA_PROTECTION=true

# Проверка аргумента командной строки для отключения защиты
if [ "$1" == "--force" ]; then
    DATA_PROTECTION=false
    echo -e "${RED}ВНИМАНИЕ: Режим защиты данных ОТКЛЮЧЕН. Это опасно для ваших данных!${NC}"
    echo "У вас есть 5 секунд чтобы отменить операцию (Ctrl+C)"
    sleep 5
fi

if [ "$DATA_PROTECTION" = true ]; then
    echo -e "${YELLOW}РЕЖИМ ЗАЩИТЫ ДАННЫХ: Скрипт выполняется в безопасном режиме${NC}"
    echo -e "${YELLOW}Размонтирование /mnt/storage ОТКЛЮЧЕНО для защиты данных${NC}"
    echo -e "${YELLOW}Для принудительного размонтирования используйте: $0 --force${NC}"
    echo ""
fi

echo -e "${GREEN}===== Скрипт очистки монтирований NFS и дисков =====${NC}"

# Проверка прав root
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Ошибка: Этот скрипт нужно запускать с правами root${NC}"
    echo "Используйте: sudo $0"
    exit 1
fi

# 1. Размонтирование всех NFS шар
echo -e "${YELLOW}Размонтирование всех NFS-шар...${NC}"
if [ "$DATA_PROTECTION" = true ]; then
    echo -e "${GREEN}ЗАЩИТА ДАННЫХ: Пропускаем размонтирование /mnt/storage/*${NC}"
    for mount in $(mount | grep -E 'nfs|type nfs' | awk '{print $3}' | grep -v "/mnt/storage"); do
        echo "Размонтирование $mount..."
        umount -f -l "$mount" 2>/dev/null
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Успешно размонтирован $mount${NC}"
        else
            echo -e "${RED}✗ Не удалось размонтировать $mount${NC}"
        fi
    done
else
    # Стандартное размонтирование без защиты
    for mount in $(mount | grep -E 'nfs|type nfs' | awk '{print $3}'); do
        echo "Размонтирование $mount..."
        umount -f -l "$mount" 2>/dev/null
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Успешно размонтирован $mount${NC}"
        else
            echo -e "${RED}✗ Не удалось размонтировать $mount${NC}"
        fi
    done
fi

# 2. Размонтирование всех несистемных дисков
echo -e "\n${YELLOW}Размонтирование несистемных дисков...${NC}"

# Определяем корневой раздел и системные монтирования
ROOT_MOUNT=$(findmnt -n -o SOURCE /)
ROOT_DISK=$(lsblk -no pkname "$ROOT_MOUNT" 2>/dev/null | head -n1)
ROOT_DISK="/dev/${ROOT_DISK}"

echo "Корневой диск: $ROOT_DISK"
echo "Корневой раздел: $ROOT_MOUNT"

# Определяем системные монтирования (/, /boot, /home и т.д.)
SYSTEM_MOUNTS=$(findmnt -n -o SOURCE -l | grep "^/dev/" | sort -u)
echo -e "${YELLOW}Системные монтирования (НЕ будут отмонтированы):${NC}"
echo "$SYSTEM_MOUNTS"

# Список всех смонтированных разделов
ALL_MOUNTS=$(findmnt -n -o SOURCE,TARGET -l | grep "^/dev/" | sort)

echo -e "\n${YELLOW}Обрабатываем все монтирования:${NC}"
echo "$ALL_MOUNTS" | while read -r line; do
    device=$(echo "$line" | awk '{print $1}')
    mountpoint=$(echo "$line" | awk '{print $2}')
    
    # Проверяем, является ли это системным монтированием
    if echo "$SYSTEM_MOUNTS" | grep -q "^$device$" && echo "$mountpoint" | grep -qE '^/(boot|home|usr|var|)$'; then
        echo -e "${GREEN}Пропускаем системное монтирование: $device на $mountpoint${NC}"
        continue
    fi
    
    # Проверяем, является ли это устройство частью корневого диска
    disk_name=$(lsblk -no pkname "$device" 2>/dev/null)
    if [ -n "$disk_name" ] && [ "/dev/$disk_name" = "$ROOT_DISK" ]; then
        echo -e "${GREEN}Пропускаем монтирование на системном диске: $device на $mountpoint${NC}"
        continue
    fi
    
    # Размонтируем несистемные диски
    echo "Размонтирование несистемного раздела: $device на $mountpoint"
    umount -f -l "$mountpoint" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Успешно размонтирован $mountpoint${NC}"
    else
        echo -e "${RED}✗ Не удалось размонтировать $mountpoint${NC}"
    fi
done

# 3. Очистка /etc/fstab от несистемных монтирований
echo -e "\n${YELLOW}Очистка fstab от несистемных монтирований...${NC}"

# Создаем резервную копию
cp /etc/fstab /etc/fstab.backup_$(date +"%Y%m%d%H%M%S")
echo -e "${GREEN}✓ Создана резервная копия fstab: /etc/fstab.backup_$(date +"%Y%m%d%H%M%S")${NC}"

# Временный файл для нового fstab
TMP_FSTAB=$(mktemp)

# Сохраняем только системные монтирования и комментарии
cat /etc/fstab | while read -r line; do
    # Пропускаем пустые строки и комментарии
    if [[ -z "$line" || "$line" =~ ^\s*# ]]; then
        echo "$line" >> "$TMP_FSTAB"
        continue
    fi
    
    # Извлекаем устройство из строки fstab
    device=$(echo "$line" | awk '{print $1}')
    mountpoint=$(echo "$line" | awk '{print $2}')
    
    # Если устройство начинается с UUID=, получаем соответствующее блочное устройство
    if [[ "$device" =~ ^UUID= ]]; then
        uuid=$(echo "$device" | cut -d= -f2)
        device=$(blkid -U "$uuid" 2>/dev/null || echo "")
    fi
    
    # Пропускаем несистемные монтирования и NFS
    if [[ "$line" =~ /mnt/storage || "$line" =~ nfs || "$mountpoint" =~ ^/mnt ]]; then
        echo -e "${YELLOW}Удаляем из fstab: $line${NC}"
        continue
    fi
    
    # Проверяем, является ли это системным монтированием
    if [[ -z "$device" || "$device" = "$ROOT_MOUNT" || "$mountpoint" = "/" || "$mountpoint" =~ ^/(boot|home|usr|var)$ ]]; then
        echo -e "${GREEN}Сохраняем системное монтирование: $line${NC}"
        echo "$line" >> "$TMP_FSTAB"
        continue
    fi
    
    # Для всех других устройств проверяем, являются ли они частью корневого диска
    if [[ "$device" =~ ^/dev/ ]]; then
        disk_name=$(lsblk -no pkname "$device" 2>/dev/null)
        if [ -n "$disk_name" ] && [ "/dev/$disk_name" = "$ROOT_DISK" ]; then
            echo -e "${GREEN}Сохраняем монтирование на системном диске: $line${NC}"
            echo "$line" >> "$TMP_FSTAB"
            continue
        fi
    fi
    
    # Если не определились - сохраняем как комментарий
    echo -e "${YELLOW}Закомментировано неопределенное монтирование: $line${NC}"
    echo "# $line" >> "$TMP_FSTAB"
done

# Копируем обновленный fstab
cp "$TMP_FSTAB" /etc/fstab
rm "$TMP_FSTAB"

echo -e "\n${GREEN}✓ fstab обновлен, несистемные монтирования удалены или закомментированы${NC}"

# 4. Перезапуск служб NFS
echo -e "\n${YELLOW}Перезапуск служб NFS...${NC}"
systemctl restart rpcbind nfs-kernel-server 2>/dev/null || true
echo -e "${GREEN}✓ Службы NFS перезапущены${NC}"

echo -e "\n${GREEN}===== Очистка завершена! =====${NC}"
echo -e "${YELLOW}Текущие монтирования:${NC}"
df -h

# Вывод содержимого fstab для проверки
echo -e "\n${YELLOW}Содержимое обновленного /etc/fstab:${NC}"
cat /etc/fstab

echo -e "\n${GREEN}Для применения изменений на всех серверах рекомендуется перезагрузить систему${NC}"