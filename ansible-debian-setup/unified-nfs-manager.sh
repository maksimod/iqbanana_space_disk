#!/bin/bash
# unified-nfs-manager.sh - Универсальный скрипт для управления NFS
# Объединяет функциональность mount-nfs-manually.sh, manual-mount-nfs.sh, optimize-nfs.sh
# 
# Использование:
#   sudo ./unified-nfs-manager.sh [опция]
#
# Опции:
#   mount       - Монтирование NFS шар
#   optimize    - Оптимизация NFS параметров
#   remount     - Перемонтирование с оптимизированными параметрами
#   status      - Проверка статуса NFS
#   help        - Показать справку

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Настройки
NFS_SERVER="192.168.0.104"
MOUNT_PREFIX="/mnt"

# Оптимальные параметры NFS
OPTIMAL_MOUNT_OPTS="vers=3,proto=tcp,rsize=1048576,wsize=1048576,async,noatime,nodiratime,actimeo=120,hard,timeo=600,retrans=3"
# Запасные параметры, если оптимальные не работают
FALLBACK_MOUNT_OPTS="vers=3,proto=tcp,rsize=262144,wsize=262144,async,soft,timeo=100"

# Функция для логирования
log() {
    echo -e "$1"
}

# Проверка на запуск от root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log "${RED}Этот скрипт должен быть запущен с правами root${NC}" 
        log "Пожалуйста, запустите: sudo $0 $*"
        exit 1
    fi
}

# Установка необходимых пакетов
install_packages() {
    log "${BLUE}=== Установка необходимых пакетов ===${NC}"
    apt-get update
    apt-get install -y nfs-common rpcbind
    
    # Запуск и включение сервиса rpcbind
    systemctl start rpcbind
    systemctl enable rpcbind
}

# Проверка доступности сервера
check_server() {
    log "${BLUE}=== Проверка доступности сервера $NFS_SERVER ===${NC}"
    if ! ping -c 1 -W 2 $NFS_SERVER > /dev/null; then
        log "${RED}Сервер $NFS_SERVER недоступен! Проверьте сетевое подключение.${NC}"
        return 1
    fi
    log "${GREEN}Сервер $NFS_SERVER доступен${NC}"
    
    # Проверка доступности портов NFS
    log "${BLUE}=== Проверка доступности портов NFS ===${NC}"
    log -n "Порт 111 (portmapper): "
    if timeout 3 bash -c "</dev/tcp/$NFS_SERVER/111" 2>/dev/null; then
        log "${GREEN}Доступен${NC}"
    else
        log "${RED}Недоступен${NC}"
        log "${YELLOW}Возможно блокировка файрволом или сервис не запущен${NC}"
        return 1
    fi

    log -n "Порт 2049 (NFS): "
    if timeout 3 bash -c "</dev/tcp/$NFS_SERVER/2049" 2>/dev/null; then
        log "${GREEN}Доступен${NC}"
    else
        log "${RED}Недоступен${NC}"
        log "${YELLOW}Возможно блокировка файрволом или сервис не запущен${NC}"
        return 1
    fi
    
    return 0
}

# Автоматическое определение доступных дисков на удаленном сервере
detect_remote_disks() {
    log "${BLUE}=== Автоматическое определение доступных дисков на сервере $NFS_SERVER ===${NC}"
    
    # Используем ssh для получения списка всех дисковых устройств на сервере
    DISKS_OUTPUT=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes agger@$NFS_SERVER "find /mnt -maxdepth 1 -name 'disk_*' -type d" 2>/dev/null)
    
    if [ $? -ne 0 ] || [ -z "$DISKS_OUTPUT" ]; then
        log "${YELLOW}Не удалось получить список дисков через SSH. Пробуем через showmount...${NC}"
        return 1
    fi
    
    # Преобразуем вывод в массив
    mapfile -t DETECTED_DISKS <<< "$DISKS_OUTPUT"
    
    if [ ${#DETECTED_DISKS[@]} -eq 0 ]; then
        log "${RED}Не найдено ни одного диска на сервере $NFS_SERVER${NC}"
        return 1
    fi
    
    log "${GREEN}Найдено ${#DETECTED_DISKS[@]} дисков на сервере:${NC}"
    for disk in "${DETECTED_DISKS[@]}"; do
        log "  - $disk"
    done
    
    return 0
}

# Получение списка доступных шар
get_shares() {
    log "${BLUE}=== Получение списка доступных NFS шар ===${NC}"
    
    # Сначала попробуем автоматически определить диски
    detect_remote_disks
    
    if [ $? -eq 0 ] && [ ${#DETECTED_DISKS[@]} -gt 0 ]; then
        # Используем обнаруженные диски для создания списка шар
        SHARES=""
        for disk in "${DETECTED_DISKS[@]}"; do
            SHARES+="$disk *\n"
        done
        log "${GREEN}Используем автоматически обнаруженные диски${NC}"
    else
        # Если не удалось определить диски через SSH, используем showmount
        log "${YELLOW}Пробуем получить список экспортов через showmount...${NC}"
        SHARES=$(timeout 5 showmount -e $NFS_SERVER 2>/dev/null)
        
        if [ $? -ne 0 ] || [ -z "$SHARES" ]; then
            log "${RED}Не удалось получить список шар через showmount.${NC}"
            log "${YELLOW}Выполняем сканирование стандартных путей монтирования...${NC}"
            
            # Если не удалось получить список через showmount, сканируем стандартные пути
            SHARES=""
            for letter in {a..z}; do
                for number in {1..15}; do
                    # Проверяем наличие дисков sda1, sdb1, ... sdz15
                    DISK_PATH="/mnt/disk_sd${letter}${number}"
                    # Пробуем выполнить простую команду ls, чтобы проверить доступность
                    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 -o BatchMode=yes agger@$NFS_SERVER "[ -d $DISK_PATH ]" 2>/dev/null; then
                        log "${GREEN}Обнаружен диск: $DISK_PATH${NC}"
                        SHARES+="$DISK_PATH *\n"
                    fi
                done
            done
            
            if [ -z "$SHARES" ]; then
                log "${RED}Не удалось обнаружить ни одного диска. Проверьте сервер.${NC}"
                return 1
            fi
        else
            log "${GREEN}Доступные шары через showmount:${NC}"
            echo "$SHARES"
        fi
    fi
    
    return 0
}

# Монтирование NFS шар
mount_shares() {
    log "${BLUE}=== Монтирование NFS шар ===${NC}"
    
    # Создаем массив для обработки
    local shares_to_mount=()
    
    # Парсим результат поиска шар
    if [ -n "$SHARES" ]; then
        echo -e "$SHARES" | grep -v "Export list" | while read share client; do
            [ -z "$share" ] && continue  # Пропускаем пустые строки
            
            share_path=$(echo $share | cut -d' ' -f1)
            shares_to_mount+=("$share_path")
            
            # Получаем имя диска из пути
            disk_name=$(basename "$share_path")
            
            # Создаем точку монтирования
            mount_point="$MOUNT_PREFIX/$disk_name"
            mkdir -p "$mount_point"
            chmod 777 "$mount_point"
            
            # Проверка, смонтирован ли уже раздел
            if mount | grep -q "$mount_point"; then
                log "${YELLOW}Точка $mount_point уже смонтирована. Пропускаем...${NC}"
                continue
            fi
            
            log "${YELLOW}Монтирование $NFS_SERVER:$share_path в $mount_point...${NC}"
            
            # Попытка монтирования с оптимизированными параметрами
            if mount -t nfs -o $OPTIMAL_MOUNT_OPTS $NFS_SERVER:$share_path $mount_point 2>/dev/null; then
                log "${GREEN}Успешно смонтировано с оптимизированными параметрами!${NC}"
                
                # Добавление в fstab для автоматического монтирования
                if ! grep -q "$NFS_SERVER:$share_path" /etc/fstab; then
                    log "${YELLOW}Добавление в /etc/fstab для автоматического монтирования...${NC}"
                    echo "$NFS_SERVER:$share_path $mount_point nfs $OPTIMAL_MOUNT_OPTS,_netdev 0 0" >> /etc/fstab
                    log "${GREEN}Добавлена запись в fstab для $mount_point${NC}"
                fi
            else
                log "${RED}Ошибка при монтировании. Пробуем альтернативные параметры...${NC}"
                
                # Пробуем с более консервативными параметрами
                if mount -t nfs -o $FALLBACK_MOUNT_OPTS $NFS_SERVER:$share_path $mount_point 2>/dev/null; then
                    log "${GREEN}Успешно смонтировано с альтернативными параметрами!${NC}"
                    
                    # Добавление в fstab для автоматического монтирования
                    if ! grep -q "$NFS_SERVER:$share_path" /etc/fstab; then
                        log "${YELLOW}Добавление в /etc/fstab для автоматического монтирования...${NC}"
                        echo "$NFS_SERVER:$share_path $mount_point nfs $FALLBACK_MOUNT_OPTS,_netdev 0 0" >> /etc/fstab
                        log "${GREEN}Добавлена запись в fstab для $mount_point${NC}"
                    fi
                else
                    log "${RED}Не удалось смонтировать шару $share_path.${NC}"
                    log "${YELLOW}Возможные проблемы:${NC}"
                    log "1. Права доступа к экспортированным каталогам"
                    log "2. Проблемы с настройками файрвола"
                    log "3. Порты NFS заблокированы"
                    log "4. Проблемы с сетевым подключением"
                fi
            fi
        done
    else
        log "${RED}Список шар пуст. Нечего монтировать.${NC}"
        return 1
    fi
}

# Оптимизация настроек ядра для NFS
optimize_kernel_params() {
    log "${BLUE}=== Оптимизация параметров ядра для NFS ===${NC}"
    
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
    log "${GREEN}Параметры ядра для NFS настроены${NC}"
    
    return 0
}

# Обновление параметров монтирования в fstab
update_fstab_params() {
    log "${BLUE}=== Обновление параметров монтирования NFS в /etc/fstab ===${NC}"
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
        
        log "${GREEN}Файл /etc/fstab обновлен${NC}"
        log "NFS записи в /etc/fstab:"
        grep "nfs" /etc/fstab
    else
        log "${YELLOW}NFS записи в /etc/fstab не найдены${NC}"
    fi
    
    return 0
}

# Перемонтирование точек монтирования
remount_shares() {
    log "${BLUE}=== Перемонтирование NFS точек монтирования ===${NC}"
    
    # Получение списка смонтированных NFS шар
    MOUNTED_SHARES=$(mount | grep nfs | awk '{print $3}')
    
    if [ -z "$MOUNTED_SHARES" ]; then
        log "${YELLOW}Нет смонтированных NFS шар${NC}"
        return 0
    fi
    
    for mount_point in $MOUNTED_SHARES; do
        log "${YELLOW}Перемонтирование $mount_point...${NC}"
        umount -f $mount_point 2>/dev/null || umount -l $mount_point 2>/dev/null
        sleep 1
    done
    
    # Монтирование всех точек из fstab
    mount -a
    
    log "${GREEN}Точки монтирования обновлены${NC}"
    return 0
}

# Вывод статуса NFS
show_status() {
    log "${BLUE}=== Статус NFS ===${NC}"
    
    # Проверка установленных пакетов
    log "${YELLOW}Установленные пакеты:${NC}"
    dpkg -l | grep -E "nfs|rpcbind" | awk '{print $2, $3}'
    
    # Проверка служб
    log "${YELLOW}Статус сервисов:${NC}"
    systemctl status rpcbind --no-pager | head -n 3
    
    # Проверка открытых портов
    log "${YELLOW}Открытые порты:${NC}"
    ss -tuln | grep -E "111|2049"
    
    # Проверка смонтированных шар
    log "${YELLOW}Смонтированные NFS шары:${NC}"
    mount | grep nfs
    
    # Проверка записей в fstab
    log "${YELLOW}Записи NFS в /etc/fstab:${NC}"
    grep nfs /etc/fstab
    
    # Статистика использования дисков
    log "${YELLOW}Использование дисков:${NC}"
    df -h | grep -E "^Filesystem|nfs"
    
    return 0
}

# Вывод справки
show_help() {
    log "${BLUE}=== Справка по скрипту unified-nfs-manager.sh ===${NC}"
    log "Использование:"
    log "  sudo ./unified-nfs-manager.sh [опция]"
    log ""
    log "Опции:"
    log "  mount       - Монтирование NFS шар"
    log "  optimize    - Оптимизация NFS параметров"
    log "  remount     - Перемонтирование с оптимизированными параметрами"
    log "  status      - Проверка статуса NFS"
    log "  help        - Показать эту справку"
    log ""
    log "Примеры:"
    log "  sudo ./unified-nfs-manager.sh mount    # Монтирование NFS шар"
    log "  sudo ./unified-nfs-manager.sh optimize # Оптимизация NFS"
    log "  sudo ./unified-nfs-manager.sh status   # Проверка статуса"
    log ""
    log "Примечание: Скрипт автоматически определяет все доступные диски на сервере."
    log ""
    return 0
}

# Основная логика скрипта
main() {
    local action="$1"
    
    case "$action" in
        mount)
            check_root
            install_packages
            check_server || exit 1
            get_shares
            mount_shares
            ;;
        optimize)
            check_root
            optimize_kernel_params
            update_fstab_params
            ;;
        remount)
            check_root
            check_server || exit 1
            remount_shares
            ;;
        status)
            show_status
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log "${RED}Неизвестная опция: $action${NC}"
            show_help
            exit 1
            ;;
    esac
    
    log "${BLUE}=== Операция завершена! ===${NC}"
    return 0
}

# Запуск скрипта с переданным аргументом
if [ $# -eq 0 ]; then
    log "${YELLOW}Не указана опция. Показываю справку...${NC}"
    show_help
    exit 0
fi

main "$1"
exit $? 