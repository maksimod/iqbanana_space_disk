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

# UUID диска и сервер
UUID="65135f15-6654-47b0-8e70-6f1a2485e8c2"
SERVER="192.168.0.106"
MOUNT_OPTIONS="rw,noatime,soft,timeo=30,retry=0,nofail"
MOUNT_POINT="/mnt/data_storage/$UUID"

echo -e "${GREEN}${BOLD}Исправление NFS монтирований для использования UUID вместо физического имени диска${NC}"

# Вывод текущих монтирований
echo -e "${YELLOW}Текущие NFS монтирования:${NC}"
mount | grep "nfs"

# Очистка /etc/fstab от старых монтирований
echo -e "${YELLOW}Очистка fstab от старых монтирований...${NC}"
FSTAB_TMP=$(mktemp)
grep -v "$SERVER:/mnt/storage/" /etc/fstab > "$FSTAB_TMP"
mv "$FSTAB_TMP" /etc/fstab

# Создание нового каталога монтирования
echo -e "${YELLOW}Проверка каталога монтирования $MOUNT_POINT...${NC}"
mkdir -p "$MOUNT_POINT"

# Размонтирование старых монтирований
echo -e "${YELLOW}Размонтирование всех существующих NFS монтирований...${NC}"
for mp in $(mount | grep "nfs" | awk '{print $3}'); do
    echo "Размонтирование $mp..."
    umount -f -l "$mp" 2>/dev/null || true
done

# Проверка доступности сервера и экспортов
echo -e "${YELLOW}Проверка доступности NFS сервера $SERVER...${NC}"
if ! timeout 5 rpcinfo -p "$SERVER" &>/dev/null; then
    echo -e "${RED}Сервер $SERVER недоступен или не отвечает на RPC запросы${NC}"
    exit 1
fi

# Запрашиваем список экспортов с сервера
echo -e "${YELLOW}Проверка экспортов на сервере $SERVER...${NC}"
EXPORTS=$(showmount -e "$SERVER" 2>/dev/null || echo "")
echo "$EXPORTS"

# Проверяем наличие экспорта по UUID пути
if ! echo "$EXPORTS" | grep -q "/mnt/storage/$UUID"; then
    echo -e "${RED}На сервере $SERVER не найден экспорт по пути /mnt/storage/$UUID!${NC}"
    echo -e "${YELLOW}Сначала выполните на сервере скрипт fix_server_exports.sh${NC}"
    exit 1
fi

# Монтирование с помощью UUID
echo -e "${YELLOW}Монтирование $SERVER:/mnt/storage/$UUID в $MOUNT_POINT...${NC}"
mount -t nfs -o "$MOUNT_OPTIONS" "$SERVER:/mnt/storage/$UUID" "$MOUNT_POINT"

# Проверка успешности монтирования
if ! mount | grep -q "$MOUNT_POINT"; then
    echo -e "${RED}ОШИБКА: Не удалось смонтировать NFS шару${NC}"
    
    # Попытка монтирования с дополнительными опциями
    echo -e "${YELLOW}Пробуем монтировать с дополнительными опциями...${NC}"
    mount -t nfs -o "$MOUNT_OPTIONS,nocto,noac" "$SERVER:/mnt/storage/$UUID" "$MOUNT_POINT"
    
    if ! mount | grep -q "$MOUNT_POINT"; then
        echo -e "${RED}Все попытки монтирования не удались${NC}"
        echo -e "${YELLOW}Диагностика проблемы:${NC}"
        echo -e "1. Проверка RPC на сервере $SERVER:"
        timeout 5 rpcinfo -p "$SERVER" || echo "Не удалось получить RPC информацию"
        
        echo -e "2. Проверка экспортов на сервере $SERVER:"
        timeout 5 showmount -e "$SERVER" || echo "Не удалось получить список экспортов"
        
        echo -e "3. Попытка с подробным выводом:"
        mount -v -t nfs -o "$MOUNT_OPTIONS" "$SERVER:/mnt/storage/$UUID" "$MOUNT_POINT"
        exit 1
    fi
fi

echo -e "${GREEN}✓ Успешно смонтирован $SERVER:/mnt/storage/$UUID в $MOUNT_POINT${NC}"

# Добавление в /etc/fstab
echo -e "${YELLOW}Добавление записи в /etc/fstab...${NC}"
echo "$SERVER:/mnt/storage/$UUID $MOUNT_POINT nfs $MOUNT_OPTIONS 0 0" >> /etc/fstab

# Вывод текущих монтирований
echo -e "${YELLOW}Новые монтирования:${NC}"
mount | grep "nfs"

echo -e "${GREEN}${BOLD}Готово! NFS шары успешно смонтированы с использованием UUID.${NC}" 