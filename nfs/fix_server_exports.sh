#!/bin/bash

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

# Проверка запуска от root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}${BOLD}Этот скрипт должен быть запущен от root!${NC}"
  echo -e "Используйте: ${YELLOW}sudo $0${NC}"
  exit 1
fi

# UUID диска
UUID="65135f15-6654-47b0-8e70-6f1a2485e8c2"
# IP клиента для экспорта
CLIENT_IP="192.168.0.103"

echo -e "${GREEN}${BOLD}Исправление экспортов NFS для использования UUID вместо физического имени диска${NC}"

# Поиск физического устройства по UUID
echo -e "${YELLOW}Поиск физического устройства по UUID ${UUID}...${NC}"
DEVICE=$(blkid | grep -i "$UUID" | awk -F: '{print $1}')
PHYSICAL_DISK=$(basename "$DEVICE")

if [ -z "$DEVICE" ]; then
    echo -e "${RED}ОШИБКА: Не найдено устройство с UUID $UUID${NC}"
    echo -e "Доступные устройства:"
    blkid
    exit 1
fi

echo -e "${GREEN}Найдено устройство: $DEVICE (имя диска: $PHYSICAL_DISK)${NC}"

# Проверка типа файловой системы
FS_TYPE=$(blkid -o value -s TYPE "$DEVICE" 2>/dev/null)
echo -e "${YELLOW}Тип файловой системы: $FS_TYPE${NC}"

# Вывод текущих монтирований
echo -e "${YELLOW}Текущие монтирования:${NC}"
mount | grep "/mnt/storage"

# Вывод текущих экспортов
echo -e "${YELLOW}Текущие экспорты NFS:${NC}"
cat /etc/exports
exportfs -v

# Создание директории для UUID
echo -e "${YELLOW}Создание директории для монтирования по UUID...${NC}"
mkdir -p "/mnt/storage/$UUID"

# Размонтирование всех существующих монтирований
echo -e "${YELLOW}Размонтирование всех существующих монтирований...${NC}"
umount -f -l "$DEVICE" 2>/dev/null || true
umount -f -l "/mnt/storage/$PHYSICAL_DISK" 2>/dev/null || true
umount -f -l "/mnt/storage/sdb" 2>/dev/null || true
umount -f -l "/mnt/storage/$UUID" 2>/dev/null || true

# Монтирование диска в новую директорию
echo -e "${YELLOW}Монтирование $DEVICE в /mnt/storage/$UUID...${NC}"
mount -t "$FS_TYPE" -o rw,noatime,nodiratime "$DEVICE" "/mnt/storage/$UUID"

# Проверка успешности монтирования
if ! mount | grep -q "/mnt/storage/$UUID"; then
    echo -e "${RED}ОШИБКА: Не удалось смонтировать диск${NC}"
    exit 1
fi

echo -e "${GREEN}Диск успешно смонтирован в /mnt/storage/$UUID${NC}"

# Установка прав доступа
echo -e "${YELLOW}Установка прав доступа...${NC}"
chmod -R 777 "/mnt/storage/$UUID"

# Обновление /etc/fstab
echo -e "${YELLOW}Обновление /etc/fstab...${NC}"
FSTAB_TMP=$(mktemp)
grep -v "/mnt/storage/" /etc/fstab > "$FSTAB_TMP"
echo "UUID=$UUID /mnt/storage/$UUID $FS_TYPE rw,noatime,nodiratime 0 0" >> "$FSTAB_TMP"
mv "$FSTAB_TMP" /etc/fstab

# Обновление NFS экспортов
echo -e "${YELLOW}Обновление NFS экспортов...${NC}"
EXPORTS_TMP=$(mktemp)
grep -v "/mnt/storage/" /etc/exports > "$EXPORTS_TMP"
echo "/mnt/storage/$UUID $CLIENT_IP(rw,sync,no_subtree_check,no_root_squash,insecure)" >> "$EXPORTS_TMP"
mv "$EXPORTS_TMP" /etc/exports

# Перезапуск NFS
echo -e "${YELLOW}Перезапуск NFS сервера...${NC}"
exportfs -ra
systemctl restart nfs-kernel-server || systemctl restart nfs-server

# Проверка статуса NFS
echo -e "${YELLOW}Статус NFS сервера:${NC}"
systemctl status nfs-kernel-server || systemctl status nfs-server
echo -e "${YELLOW}Новые экспорты:${NC}"
exportfs -v

echo -e "${GREEN}${BOLD}Готово! Сервер настроен для использования UUID вместо имени диска.${NC}"
echo -e "${YELLOW}Теперь на клиенте выполните:${NC}"
echo -e "${BOLD}sudo umount -f -l /mnt/data_storage/65135f15-6654-47b0-8e70-6f1a2485e8c2${NC}"
echo -e "${BOLD}sudo mount -t nfs -o rw,noatime,soft,timeo=30,retry=0,nofail 192.168.0.106:/mnt/storage/65135f15-6654-47b0-8e70-6f1a2485e8c2 /mnt/data_storage/65135f15-6654-47b0-8e70-6f1a2485e8c2${NC}" 