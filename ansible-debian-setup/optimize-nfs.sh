#!/bin/bash
# Скрипт для оптимизации NFS для более быстрой передачи файлов

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

echo -e "${BLUE}=== Оптимизация NFS для высокой производительности ===${NC}"

# 1. Улучшение параметров ядра для NFS
echo -e "${YELLOW}Настройка параметров ядра для NFS...${NC}"

# Создание файла с настройками sysctl
cat > /etc/sysctl.d/90-nfs-performance.conf << EOF
# Оптимизация NFS
# Увеличение размера буфера чтения/записи
net.core.rmem_default = 262144
net.core.rmem_max = 16777216
net.core.wmem_default = 262144
net.core.wmem_max = 16777216

# Оптимизация сетевого стека
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.core.netdev_max_backlog = 5000

# Оптимизация производительности файловой системы
vm.dirty_ratio = 40
vm.dirty_background_ratio = 10
vm.dirty_expire_centisecs = 6000
EOF

# Применение настроек sysctl
sysctl -p /etc/sysctl.d/90-nfs-performance.conf
echo -e "${GREEN}Параметры ядра для NFS настроены${NC}"

# 2. Обновление настроек exports
echo -e "${YELLOW}Обновление настроек NFS exports...${NC}"
# Проверка, существует ли файл exports
if [ -f /etc/exports ]; then
    # Создание резервной копии
    cp /etc/exports /etc/exports.backup.$(date +%Y%m%d%H%M%S)
    
    # Замена sync на async
    sed -i 's/sync/async/g' /etc/exports
    
    # Добавление no_wdelay, если его нет
    sed -i '/async/ s/)/, no_wdelay)/' /etc/exports
    sed -i '/async.*no_wdelay/ s/no_wdelay, no_wdelay/no_wdelay/' /etc/exports
    
    echo -e "${GREEN}Файл /etc/exports обновлен${NC}"
    echo "Содержимое /etc/exports:"
    cat /etc/exports
else
    echo -e "${RED}Файл /etc/exports не найден${NC}"
fi

# 3. Обновление параметров монтирования
echo -e "${YELLOW}Обновление параметров монтирования NFS в /etc/fstab...${NC}"
if grep -q "nfs" /etc/fstab; then
    # Создание резервной копии
    cp /etc/fstab /etc/fstab.backup.$(date +%Y%m%d%H%M%S)
    
    # Обновление параметров монтирования
    sed -i '/nfs/ s/,sync/,async/' /etc/fstab
    sed -i '/nfs/ s/rsize=[0-9]*/rsize=1048576/' /etc/fstab
    sed -i '/nfs/ s/wsize=[0-9]*/wsize=1048576/' /etc/fstab
    
    # Добавление noatime и nodiratime, если их нет
    sed -i '/nfs/ s/async/async,noatime,nodiratime/' /etc/fstab
    sed -i '/noatime.*noatime/ s/noatime, noatime/noatime/' /etc/fstab
    sed -i '/nodiratime.*nodiratime/ s/nodiratime, nodiratime/nodiratime/' /etc/fstab
    
    # Добавление actimeo, если его нет
    sed -i '/nfs/ s/nodiratime/nodiratime,actimeo=120/' /etc/fstab
    sed -i '/actimeo=[0-9]*.*actimeo=[0-9]*/ s/actimeo=[0-9]*, actimeo=[0-9]*/actimeo=120/' /etc/fstab
    
    echo -e "${GREEN}Файл /etc/fstab обновлен${NC}"
    echo "NFS записи в /etc/fstab:"
    grep "nfs" /etc/fstab
else
    echo -e "${YELLOW}NFS записи в /etc/fstab не найдены${NC}"
fi

# 4. Перезапуск NFS-сервера
echo -e "${YELLOW}Перезапуск NFS-сервера...${NC}"
if systemctl restart nfs-kernel-server; then
    echo -e "${GREEN}NFS-сервер успешно перезапущен${NC}"
else
    echo -e "${RED}Ошибка при перезапуске NFS-сервера${NC}"
fi

# 5. Перемонтирование точек монтирования для применения новых параметров
echo -e "${YELLOW}Перемонтирование NFS точек монтирования...${NC}"
mount -a
echo -e "${GREEN}Точки монтирования обновлены${NC}"

echo -e "${BLUE}=== Оптимизация NFS для высокой производительности завершена ===${NC}"
echo ""
echo -e "${GREEN}Теперь NFS настроен для более быстрой передачи больших файлов.${NC}"
echo "Текущие активные монтирования NFS:"
mount | grep nfs 