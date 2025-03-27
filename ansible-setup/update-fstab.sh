#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Скрипт прямого обновления fstab для NFS сервера и клиента ===${NC}"

# Параметры
SERVER_IP="192.168.0.108"
SERVER_USER="root"
SERVER_PASS="rootpassword"
CLIENT_IP="192.168.0.110"
NFS_MOUNT_BASE="/mnt/storage"

# Проверка наличия sshpass
if ! command -v sshpass &> /dev/null; then
    echo -e "${RED}Установка sshpass...${NC}"
    apt-get update -qq && apt-get install -y sshpass
fi

# Проверка наличия смонтированных NFS дисков
echo -e "${YELLOW}Проверка смонтированных NFS дисков...${NC}"
MOUNTED_DISKS=$(df -h | grep -E "$SERVER_IP:$NFS_MOUNT_BASE" | awk '{print $1}' | cut -d':' -f2)

if [ -z "$MOUNTED_DISKS" ]; then
    echo -e "${RED}ОШИБКА: Нет смонтированных NFS дисков!${NC}"
    exit 1
fi

echo -e "${GREEN}Найдены смонтированные NFS диски:${NC}"
echo "$MOUNTED_DISKS"

# Создаем временный каталог для работы
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR" || exit 1

# Обновляем fstab на сервере
echo -e "${YELLOW}Обновляем fstab на сервере...${NC}"

# Получаем информацию о дисках на сервере
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "lsblk -p | grep -E 'sd[b-z]'" > server_disks.txt

# Создаем резервную копию fstab на сервере
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "cp /etc/fstab /etc/fstab.bak.$(date +%s)"

# Читаем оригинальный fstab без строк NFS и создаем новый
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "grep -v '$NFS_MOUNT_BASE' /etc/fstab" > server_fstab.new

# Добавляем записи для дисков
for DISK_PATH in $(echo "$MOUNTED_DISKS" | sort); do
    # Получаем базовое имя диска (sdb, sdc и т.д.)
    DISK_NAME=$(basename "$DISK_PATH")
    
    # Находим соответствующий раздел
    PARTITION=$(sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "lsblk -pno NAME | grep -E '/dev/${DISK_NAME}[0-9]+' | head -1")
    
    if [ -z "$PARTITION" ]; then
        PARTITION="/dev/${DISK_NAME}1"
    fi
    
    # Добавляем запись в новый fstab
    echo "$PARTITION $NFS_MOUNT_BASE/$DISK_NAME xfs defaults,noatime,nodiratime,logbufs=8,logbsize=256k,largeio,inode64,swalloc,allocsize=1m,nobarrier 0 0" >> server_fstab.new
    
    echo -e "${GREEN}Добавлена запись для $PARTITION на сервере${NC}"
done

# Копируем новый fstab на сервер
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no server_fstab.new "$SERVER_USER@$SERVER_IP:/etc/fstab"

# Обновляем fstab на клиенте
echo -e "${YELLOW}Обновляем fstab на клиенте...${NC}"

# Создаем резервную копию fstab на клиенте
cp /etc/fstab "/etc/fstab.bak.$(date +%s)"

# Читаем оригинальный fstab без строк NFS и создаем новый
grep -v "$SERVER_IP:$NFS_MOUNT_BASE" /etc/fstab > client_fstab.new

# Добавляем записи для дисков
for DISK_PATH in $(echo "$MOUNTED_DISKS" | sort); do
    # Получаем базовое имя диска (sdb, sdc и т.д.)
    DISK_NAME=$(basename "$DISK_PATH")
    
    # Добавляем запись в новый fstab
    echo "$SERVER_IP:$NFS_MOUNT_BASE/$DISK_NAME $NFS_MOUNT_BASE/$DISK_NAME nfs rw,soft,tcp,noatime,nodiratime,rsize=1048576,wsize=1048576,timeo=600,retrans=2,noresvport,_netdev,bg,nofail,nconnect=16,fsc,actimeo=600,nocto,noac,lookupcache=positive,local_lock=none 0 0" >> client_fstab.new
    
    echo -e "${GREEN}Добавлена запись для $DISK_NAME на клиенте${NC}"
done

# Копируем новый fstab на клиент
cp client_fstab.new /etc/fstab

# Проверяем результаты
echo -e "${YELLOW}Проверка обновленных fstab файлов...${NC}"
echo -e "${YELLOW}=== fstab на сервере ===${NC}"
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "cat /etc/fstab | grep -v '^#'"

echo -e "${YELLOW}=== fstab на клиенте ===${NC}"
cat /etc/fstab | grep -v '^#'

# Очистка
cd /
rm -rf "$TEMP_DIR"

echo -e "${GREEN}Обновление fstab завершено успешно!${NC}"
echo -e "${YELLOW}Для применения изменений может потребоваться перезагрузка или перемонтирование.${NC}"