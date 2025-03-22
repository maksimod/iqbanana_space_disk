#!/bin/bash
# Скрипт для ручного монтирования NFS-шар с сервера agger
# Автоматически определяет доступные шары и монтирует их

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Проверка на запуск от root
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}Этот скрипт должен быть запущен с правами root${NC}" 
    echo "Пожалуйста, запустите: sudo $0"
    exit 1
fi

# IP-адрес сервера agger
AGGER_IP="192.168.0.104"

# Проверка установленных пакетов
echo -e "${BLUE}=== Проверка необходимых пакетов ===${NC}"
if ! dpkg -l | grep -qE "nfs-common"; then
    echo -e "${YELLOW}Установка пакета nfs-common...${NC}"
    apt-get update
    apt-get install -y nfs-common
fi

# Проверка доступности сервера
echo -e "${BLUE}=== Проверка доступности сервера $AGGER_IP ===${NC}"
if ! ping -c 1 -W 1 $AGGER_IP > /dev/null; then
    echo -e "${RED}Сервер $AGGER_IP недоступен! Проверьте сетевое подключение.${NC}"
    exit 1
fi

# Проверка доступности портов NFS
echo -e "${BLUE}=== Проверка доступности портов NFS на сервере $AGGER_IP ===${NC}"
echo -n "Порт 111 (portmapper): "
if timeout 3 bash -c "</dev/tcp/$AGGER_IP/111" 2>/dev/null; then
    echo -e "${GREEN}Доступен${NC}"
else
    echo -e "${RED}Недоступен${NC}"
    echo -e "${YELLOW}Возможно блокировка файрволом или сервис не запущен${NC}"
fi

echo -n "Порт 2049 (NFS): "
if timeout 3 bash -c "</dev/tcp/$AGGER_IP/2049" 2>/dev/null; then
    echo -e "${GREEN}Доступен${NC}"
else
    echo -e "${RED}Недоступен${NC}"
    echo -e "${YELLOW}Возможно блокировка файрволом или сервис не запущен${NC}"
fi

# Получение доступных шар с сервера
echo -e "${BLUE}=== Получение списка доступных NFS шар ===${NC}"
echo "Запуск: showmount -e $AGGER_IP"
SHARES=$(timeout 5 showmount -e $AGGER_IP 2>/dev/null)
if [ $? -ne 0 ]; then
    echo -e "${RED}Не удалось получить список шар. RPC сервис может быть недоступен.${NC}"
    echo -e "${YELLOW}Пробуем альтернативный метод (напрямую указываем шары)...${NC}"
    SHARES="/mnt/disk_sdb1 *
/mnt/disk_sdb5 *
/mnt/disk_sda1 *
/mnt/disk_sdc1 *"
else
    echo -e "${GREEN}Доступные шары:${NC}"
    echo "$SHARES"
fi

# Создание точек монтирования и монтирование
echo -e "${BLUE}=== Монтирование шар ===${NC}"
echo "$SHARES" | grep -v "Export list" | while read share client; do
    # Получаем только путь шары
    share_path=$(echo $share | cut -d' ' -f1)
    # Получаем имя диска из пути
    disk_name=$(basename $share_path)
    
    # Создаем точку монтирования
    mount_point="/mnt/remote_$disk_name"
    mkdir -p $mount_point
    
    echo "Монтирование $AGGER_IP:$share_path в $mount_point"
    
    # Попытка монтирования с различными параметрами
    if mount -t nfs -o vers=3,proto=tcp,noatime,nodiratime $AGGER_IP:$share_path $mount_point 2>/dev/null; then
        echo -e "${GREEN}Успешно смонтировано!${NC}"
        echo "Проверка содержимого:"
        ls -la $mount_point | head -n 10
        echo ""
    else
        echo -e "${RED}Ошибка при монтировании. Пробуем альтернативные параметры...${NC}"
        
        # Пробуем с другими параметрами
        if mount -t nfs -o vers=3,soft,timeo=100 $AGGER_IP:$share_path $mount_point 2>/dev/null; then
            echo -e "${GREEN}Успешно смонтировано с альтернативными параметрами!${NC}"
            echo "Проверка содержимого:"
            ls -la $mount_point | head -n 10
            echo ""
        else
            echo -e "${RED}Не удалось смонтировать шару $share_path.${NC}"
            echo -e "${YELLOW}Возможные проблемы:${NC}"
            echo "1. Права доступа к экспортированным каталогам"
            echo "2. Проблемы с настройками файрвола"
            echo "3. Порты NFS заблокированы"
            echo "4. Проблемы с сетевым подключением"
            echo ""
        fi
    fi
done

# Добавление записей в fstab для автоматического монтирования
echo -e "${BLUE}=== Добавление записей в /etc/fstab ===${NC}"
read -p "Добавить монтирование в fstab для автозагрузки? (y/n): " add_fstab

if [ "$add_fstab" = "y" ]; then
    echo "$SHARES" | grep -v "Export list" | while read share client; do
        share_path=$(echo $share | cut -d' ' -f1)
        disk_name=$(basename $share_path)
        mount_point="/mnt/remote_$disk_name"
        
        # Проверка на существующую запись
        if grep -q "$AGGER_IP:$share_path" /etc/fstab; then
            echo -e "${YELLOW}Запись для $AGGER_IP:$share_path уже существует в fstab${NC}"
        else
            echo "$AGGER_IP:$share_path $mount_point nfs vers=3,proto=tcp,_netdev,soft,timeo=100 0 0" >> /etc/fstab
            echo -e "${GREEN}Добавлена запись в fstab для $mount_point${NC}"
        fi
    done
    echo -e "${GREEN}Записи в fstab обновлены. При перезагрузке шары будут монтироваться автоматически.${NC}"
fi

echo -e "${BLUE}=== Завершено! ===${NC}"
echo "Для проверки смонтированных шар выполните: mount | grep nfs"
mount | grep nfs 