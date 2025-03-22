#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Настройка монтирования дисков через NFS ===${NC}"

# Установка переменных
NFS_SERVER="192.168.0.104"
MOUNT_DIRS=(
    "disk_sda1"
    "disk_sdb1" 
    "disk_sdb5"
    "disk_sdc1"
    "disk_sdd1"
)

# Установка необходимых пакетов
echo -e "${YELLOW}Установка необходимых пакетов...${NC}"
sudo apt update
sudo apt install -y nfs-common rpcbind

# Запуск и включение сервиса rpcbind
echo -e "${YELLOW}Запуск и включение сервиса rpcbind...${NC}"
sudo systemctl start rpcbind
sudo systemctl enable rpcbind

# Проверка доступности NFS сервера
echo -e "${YELLOW}Проверка доступности сервера NFS...${NC}"
if ping -c 1 -W 2 $NFS_SERVER > /dev/null 2>&1; then
    echo -e "${GREEN}Сервер NFS ($NFS_SERVER) доступен${NC}"
else
    echo -e "${RED}Сервер NFS ($NFS_SERVER) недоступен! Проверьте сетевое подключение.${NC}"
    exit 1
fi

# Проверка доступности NFS порта
echo -e "${YELLOW}Проверка доступности порта NFS...${NC}"
if nc -z $NFS_SERVER 2049 > /dev/null 2>&1; then
    echo -e "${GREEN}Порт NFS доступен${NC}"
else
    echo -e "${RED}Порт NFS недоступен! Проверьте настройки firewall.${NC}"
    exit 1
fi

# Получение списка экспортов
echo -e "${YELLOW}Получение списка NFS экспортов...${NC}"
showmount -e $NFS_SERVER

# Создание точек монтирования и монтирование
echo -e "${YELLOW}Создание точек монтирования и монтирование...${NC}"
for dir in "${MOUNT_DIRS[@]}"; do
    # Создание точки монтирования
    echo -e "${YELLOW}Создание точки монтирования /mnt/$dir...${NC}"
    sudo mkdir -p /mnt/$dir
    sudo chmod 777 /mnt/$dir
    
    # Проверка, смонтирован ли уже раздел
    if mount | grep -q "/mnt/$dir"; then
        echo -e "${YELLOW}Точка /mnt/$dir уже смонтирована. Размонтирование...${NC}"
        sudo umount -f /mnt/$dir 2>/dev/null || sudo umount -l /mnt/$dir 2>/dev/null
    fi
    
    # Монтирование
    echo -e "${YELLOW}Монтирование $NFS_SERVER:/mnt/$dir в /mnt/$dir...${NC}"
    sudo mount -t nfs -o rw,hard,timeo=600,retrans=3,proto=tcp,noatime $NFS_SERVER:/mnt/$dir /mnt/$dir
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Успешно смонтировано $NFS_SERVER:/mnt/$dir в /mnt/$dir${NC}"
        
        # Добавление в fstab для автоматического монтирования при загрузке
        if ! grep -q "$NFS_SERVER:/mnt/$dir" /etc/fstab; then
            echo -e "${YELLOW}Добавление в /etc/fstab для автоматического монтирования...${NC}"
            echo "$NFS_SERVER:/mnt/$dir /mnt/$dir nfs rw,hard,timeo=600,retrans=3,proto=tcp,noatime 0 0" | sudo tee -a /etc/fstab > /dev/null
        fi
    else
        echo -e "${RED}Ошибка при монтировании $NFS_SERVER:/mnt/$dir в /mnt/$dir${NC}"
    fi
done

# Проверка смонтированных разделов
echo -e "${YELLOW}Проверка смонтированных разделов:${NC}"
df -h | grep nfs

echo -e "${GREEN}Настройка монтирования дисков через NFS завершена${NC}" 