#!/bin/bash

# Подключаем общие функции из NFS
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "${SCRIPT_DIR}/../nfs/common_functions.sh"

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Загрузка конфигурации
load_config() {
    # Устанавливаем значение по умолчанию для LOG_FILE до загрузки конфигурации
    LOG_FILE="${SCRIPT_DIR}/backup.log"
    
    if [ -f "${SCRIPT_DIR}/backup_config.sh" ]; then
        source "${SCRIPT_DIR}/backup_config.sh"
    else
        echo -e "${RED}Ошибка: Конфигурационный файл не найден: ${SCRIPT_DIR}/backup_config.sh${NC}"
        exit 1
    fi
    
    # Загружаем .env файл
    if [ -f "${SCRIPT_DIR}/../nfs/.env" ]; then
        source "${SCRIPT_DIR}/../nfs/.env"
    else
        echo -e "${YELLOW}Предупреждение: Файл .env не найден. Будут использованы значения по умолчанию.${NC}"
    fi
    
    # Проверяем и устанавливаем SSH_HOST, если он не определен
    if [ -z "$SSH_HOST" ]; then
        if [ -n "$DEFAULT_SSH_HOST" ]; then
            SSH_HOST="$DEFAULT_SSH_HOST"
            echo -e "${YELLOW}Предупреждение: SSH_HOST не найден в .env, используем значение из backup_config.sh: $SSH_HOST${NC}"
        else
            # Пытаемся найти в storage_config.sh
            if [ -f "${SCRIPT_DIR}/../nfs/storage_config.sh" ]; then
                SSH_HOST_FROM_CONFIG=$(grep -E "^SSH_HOST=" "${SCRIPT_DIR}/../nfs/storage_config.sh" | cut -d'"' -f2)
                if [ -n "$SSH_HOST_FROM_CONFIG" ]; then
                    SSH_HOST="$SSH_HOST_FROM_CONFIG"
                    echo -e "${YELLOW}Предупреждение: SSH_HOST не найден в .env, используем значение из storage_config.sh: $SSH_HOST${NC}"
                else
                    echo -e "${RED}Ошибка: SSH_HOST не найден ни в .env, ни в storage_config.sh${NC}"
                    exit 1
                fi
            else
                echo -e "${RED}Ошибка: SSH_HOST не определен, и файл storage_config.sh не найден${NC}"
                exit 1
            fi
        fi
    fi
    
    # Проверяем, что SSH_PORTS определен
    if [ -z "$SSH_PORTS" ] || [ ${#SSH_PORTS[@]} -eq 0 ]; then
        echo -e "${YELLOW}Предупреждение: SSH_PORTS не определен в .env, используем значения из backup_config.sh${NC}"
        # Устанавливаем SSH_PORTS на основе BACKUP_SERVER, если он определен
        if [ -n "$BACKUP_SERVER" ]; then
            # Стандартный порт SSH с номером порта по умолчанию
            SSH_PORTS=("$BACKUP_SERVER:2223")
            echo -e "${YELLOW}Автоматически установлено: SSH_PORTS=($BACKUP_SERVER:2223)${NC}"
        fi
    fi
    
    # Настройка BORG_PASSPHRASE
    if [ -z "$BORG_PASSPHRASE" ]; then
        # Если переменной нет в .env, используем значение из конфига
        export BORG_PASSPHRASE="$DEFAULT_BORG_PASSPHRASE"
    fi
}

# Функция логирования
log_message() {
    local level=$1
    local message=$2
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    
    echo -e "[$timestamp] [$level] $message"
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
}

log_info() {
    log_message "INFO" "${GREEN}$1${NC}"
}

log_warning() {
    log_message "WARNING" "${YELLOW}$1${NC}"
}

log_error() {
    log_message "ERROR" "${RED}$1${NC}"
}

# Функция для проверки и установки Borg Backup
install_borg() {
    local server=$1
    local port=$2
    
    log_info "Проверка установки Borg Backup на сервере $server"
    
    # Проверяем, установлен ли уже Borg
    if remote_exec "$server" "$port" "which borg" &>/dev/null; then
        log_info "Borg Backup уже установлен на сервере $server"
        return 0
    fi
    
    log_info "Установка Borg Backup на сервере $server"
    
    # Обновляем пакеты и устанавливаем Borg
    if ! remote_exec "$server" "$port" "apt-get update && apt-get install -y borgbackup"; then
        log_error "Не удалось установить Borg Backup на сервере $server"
        return 1
    fi
    
    log_info "Borg Backup успешно установлен на сервере $server"
    return 0
}

# Функция для проверки используемости диска
is_disk_in_use() {
    local server=$1
    local port=$2
    local disk=$3
    
    # Проверяем, используется ли диск в данный момент
    local in_use=$(remote_exec "$server" "$port" "lsblk -o NAME,MOUNTPOINT -n | grep $disk | grep -v '^$disk ' | awk '{print \$2}' | grep -v '^$'")
    
    if [ -n "$in_use" ]; then
        return 0  # Диск используется
    else
        return 1  # Диск не используется
    fi
}

# Функция для запроса подтверждения
ask_confirmation() {
    local message=$1
    local default=${2:-"n"}  # По умолчанию "n"
    
    if [ "$default" = "y" ]; then
        echo -n -e "$message [Y/n]: "
        read -r response
        if [[ -z "$response" || "$response" =~ ^[Yy] ]]; then
            return 0
        else
            return 1
        fi
    else
        echo -n -e "$message [y/N]: "
        read -r response
        if [[ "$response" =~ ^[Yy] ]]; then
            return 0
        else
            return 1
        fi
    fi
}

# Функция для подготовки диска назначения
prepare_target_disk() {
    local server=$1
    local port=$2
    local disk=$3
    local mount_point=$4
    
    log_info "Подготовка диска $disk для бэкапа на сервере $server"
    
    # Проверяем существование диска
    if ! remote_exec "$server" "$port" "test -b /dev/$disk" &>/dev/null; then
        log_error "Диск /dev/$disk не существует на сервере $server"
        return 1
    fi
    
    # Получаем текущую точку монтирования
    local current_mount=$(remote_exec "$server" "$port" "mount | grep -w '/dev/$disk' | awk '{print \$3}'")
    
    # Проверяем, смонтирован ли диск
    if [ -n "$current_mount" ]; then
        if [ "$current_mount" != "$mount_point" ]; then
            log_warning "Диск /dev/$disk смонтирован в $current_mount, а должен быть в $mount_point"
            
            # Проверяем, используется ли диск
            if is_disk_in_use "$server" "$port" "$disk"; then
                log_warning "Диск /dev/$disk активно используется. Содержимое:"
                remote_exec "$server" "$port" "ls -la '$current_mount' 2>/dev/null | head -n 5" || true
                
                # Запрашиваем подтверждение для размонтирования
                if ask_confirmation "${YELLOW}ВНИМАНИЕ! Диск /dev/$disk уже используется. Размонтировать и подготовить для использования в качестве диска бэкапа?${NC}"; then
                    log_info "Отмонтирование диска /dev/$disk по запросу пользователя"
                    if ! remote_exec "$server" "$port" "umount '$current_mount'"; then
                        log_error "Не удалось отмонтировать диск /dev/$disk. Возможно, он используется."
                        return 1
                    fi
                else
                    log_info "Операция отменена пользователем"
                    return 1
                fi
            else
                log_info "Отмонтирование диска /dev/$disk"
                if ! remote_exec "$server" "$port" "umount '$current_mount'"; then
                    log_error "Не удалось отмонтировать диск /dev/$disk"
                    return 1
                fi
            fi
        else
            log_info "Диск /dev/$disk уже смонтирован в $mount_point"
            return 0
        fi
    fi
    
    # Создаем точку монтирования, если она не существует
    remote_exec "$server" "$port" "mkdir -p $mount_point"
    
    # Проверяем, есть ли на диске файловая система
    if ! remote_exec "$server" "$port" "blkid /dev/$disk" &>/dev/null; then
        log_warning "На диске /dev/$disk нет файловой системы."
        
        # Запрашиваем подтверждение для форматирования
        if ask_confirmation "${YELLOW}ВНИМАНИЕ! Диск /dev/$disk не отформатирован. Форматировать с файловой системой ext4?${NC}"; then
            log_info "Форматирование диска /dev/$disk с файловой системой ext4..."
            if ! remote_exec "$server" "$port" "mkfs.ext4 -F /dev/$disk"; then
                log_error "Не удалось создать файловую систему на диске /dev/$disk"
                return 1
            fi
        else
            log_info "Форматирование отменено пользователем"
            return 1
        fi
    fi
    
    # Монтируем диск
    if ! remote_exec "$server" "$port" "mount /dev/$disk $mount_point"; then
        log_error "Не удалось смонтировать диск /dev/$disk в $mount_point"
        return 1
    fi
    
    # Обновляем fstab для автоматического монтирования при перезагрузке
    log_info "Настройка автоматического монтирования диска /dev/$disk при перезагрузке"
    
    # Получаем UUID диска
    local disk_uuid=$(remote_exec "$server" "$port" "blkid -s UUID -o value /dev/$disk")
    
    # Проверяем, есть ли уже запись в fstab
    if ! remote_exec "$server" "$port" "grep -q '$mount_point' /etc/fstab"; then
        # Добавляем запись в fstab с опцией nofail, чтобы система загружалась даже без диска
        remote_exec "$server" "$port" "echo 'UUID=$disk_uuid $mount_point ext4 defaults,nofail 0 2' >> /etc/fstab"
        log_info "Добавлена опция nofail в fstab - система загрузится даже при отсутствии диска бэкапа"
    fi
    
    log_info "Диск /dev/$disk успешно подготовлен и смонтирован в $mount_point"
    return 0
}

# Функция для инициализации репозитория Borg
init_borg_repo() {
    local server=$1
    local port=$2
    local repo_path=$3
    
    log_info "Инициализация репозитория Borg в $repo_path на сервере $server"
    
    # Проверяем, существует ли уже репозиторий
    if remote_exec "$server" "$port" "test -d $repo_path/data" &>/dev/null; then
        log_info "Репозиторий Borg уже существует в $repo_path"
        return 0
    fi
    
    # Создаем директорию для репозитория
    remote_exec "$server" "$port" "mkdir -p $repo_path"
    
    # Инициализируем репозиторий Borg с шифрованием
    if ! remote_exec "$server" "$port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg init --encryption=repokey $repo_path"; then
        log_error "Не удалось инициализировать репозиторий Borg в $repo_path"
        return 1
    fi
    
    log_info "Репозиторий Borg успешно инициализирован в $repo_path"
    return 0
}

# Функция для создания бэкапа диска
create_backup() {
    local server=$1
    local port=$2
    local source_disk=$3
    local repo_path=$4
    
    local backup_name="$(date +%Y-%m-%d_%H-%M-%S)"
    log_info "Создание бэкапа диска /dev/$source_disk на сервере $server с именем $backup_name"
    
    # Выполняем пользовательский скрипт до бэкапа, если он существует
    if [ -n "$PRE_BACKUP_SCRIPT" ] && remote_exec "$server" "$port" "test -f $PRE_BACKUP_SCRIPT"; then
        log_info "Выполнение пре-бэкап скрипта: $PRE_BACKUP_SCRIPT"
        remote_exec "$server" "$port" "bash $PRE_BACKUP_SCRIPT"
    fi
    
    # Создаем бэкап диска
    # Используем --read-special для работы с блочными устройствами
    if ! remote_exec "$server" "$port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg create --verbose --stats --read-special $repo_path::$backup_name /dev/$source_disk"; then
        log_error "Не удалось создать бэкап диска /dev/$source_disk"
        return 1
    fi
    
    # Выполняем пользовательский скрипт после бэкапа, если он существует
    if [ -n "$POST_BACKUP_SCRIPT" ] && remote_exec "$server" "$port" "test -f $POST_BACKUP_SCRIPT"; then
        log_info "Выполнение пост-бэкап скрипта: $POST_BACKUP_SCRIPT"
        remote_exec "$server" "$port" "bash $POST_BACKUP_SCRIPT"
    fi
    
    log_info "Бэкап диска /dev/$source_disk успешно создан с именем $backup_name"
    
    # Очистка старых бэкапов
    prune_old_backups "$server" "$port" "$repo_path"
    
    return 0
}

# Функция для удаления старых бэкапов
prune_old_backups() {
    local server=$1
    local port=$2
    local repo_path=$3
    
    log_info "Очистка старых бэкапов в репозитории $repo_path"
    
    # Удаляем старые бэкапы, оставляя только MAX_BACKUPS последних
    if ! remote_exec "$server" "$port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg prune --keep-last=$MAX_BACKUPS --verbose $repo_path"; then
        log_error "Не удалось очистить старые бэкапы"
        return 1
    fi
    
    log_info "Старые бэкапы успешно очищены, оставлено последних $MAX_BACKUPS"
    return 0
}

# Функция для получения списка бэкапов
list_backups() {
    local server=$1
    local port=$2
    local repo_path=$3
    
    log_info "Получение списка бэкапов из репозитория $repo_path"
    
    # Получаем список бэкапов
    remote_exec "$server" "$port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg list $repo_path"
    
    return 0
}

# Функция для восстановления бэкапа
restore_backup() {
    local server=$1
    local port=$2
    local source_disk=$3
    local repo_path=$4
    local backup_name=$5
    
    log_info "Восстановление бэкапа $backup_name на диск /dev/$source_disk"
    
    # Проверяем существование бэкапа
    if ! remote_exec "$server" "$port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg list $repo_path::$backup_name" &>/dev/null; then
        log_error "Бэкап $backup_name не существует в репозитории $repo_path"
        return 1
    fi
    
    log_warning "Восстановление полностью перезапишет содержимое диска /dev/$source_disk!"
    
    # Восстанавливаем бэкап на диск
    if ! remote_exec "$server" "$port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg extract --stdout $repo_path::$backup_name > /dev/$source_disk"; then
        log_error "Не удалось восстановить бэкап $backup_name на диск /dev/$source_disk"
        return 1
    fi
    
    log_info "Бэкап $backup_name успешно восстановлен на диск /dev/$source_disk"
    return 0
}

# Функция для настройки автоматических бэкапов
setup_automatic_backups() {
    local server=$1
    local port=$2
    local script_path=$3
    local frequency=$4
    
    log_info "Настройка автоматических бэкапов с частотой: $frequency"
    
    # Определяем соответствующую запись для crontab в зависимости от частоты
    local cron_entry=""
    case "$frequency" in
        "hourly")
            cron_entry="0 * * * * $script_path"
            ;;
        "daily")
            cron_entry="0 0 * * * $script_path"
            ;;
        "weekly")
            cron_entry="0 0 * * 0 $script_path"
            ;;
        "monthly")
            cron_entry="0 0 1 * * $script_path"
            ;;
        *)
            log_error "Неизвестная частота бэкапов: $frequency. Используем daily"
            cron_entry="0 0 * * * $script_path"
            ;;
    esac
    
    # Проверяем права на скрипт
    if ! remote_exec "$server" "$port" "test -x $script_path"; then
        log_error "Скрипт $script_path не имеет прав на выполнение"
        return 1
    fi
    
    # Создаем временный файл с новой записью crontab
    local temp_cron=$(mktemp)
    
    # Получаем текущий crontab и добавляем нашу запись
    if remote_exec "$server" "$port" "crontab -l" &>/dev/null; then
        remote_exec "$server" "$port" "crontab -l" > "$temp_cron"
    fi
    
    # Проверяем, существует ли уже такая запись
    if grep -q "$script_path" "$temp_cron"; then
        log_info "Задание cron для бэкапа уже существует"
    else
        # Добавляем нашу запись в crontab
        echo "$cron_entry" >> "$temp_cron"
        
        # Отправляем файл на сервер через SSH прокси
        if ! remote_exec "$server" "$port" "cat > /tmp/backup_cron.tmp" < "$temp_cron"; then
            log_error "Не удалось отправить файл crontab на сервер"
            rm -f "$temp_cron"
            return 1
        fi
        
        # Проверяем, что файл создан и не пустой
        if ! remote_exec "$server" "$port" "test -s /tmp/backup_cron.tmp"; then
            log_error "Временный файл crontab пуст или не создан"
            remote_exec "$server" "$port" "rm -f /tmp/backup_cron.tmp"
            rm -f "$temp_cron"
            return 1
        fi
        
        # Проверяем права на временный файл
        if ! remote_exec "$server" "$port" "chmod 600 /tmp/backup_cron.tmp"; then
            log_error "Не удалось установить права на временный файл crontab"
            remote_exec "$server" "$port" "rm -f /tmp/backup_cron.tmp"
            rm -f "$temp_cron"
            return 1
        fi
        
        # Устанавливаем новый crontab и удаляем временный файл
        if ! remote_exec "$server" "$port" "crontab /tmp/backup_cron.tmp"; then
            log_error "Не удалось установить новый crontab. Проверьте права доступа и формат файла."
            remote_exec "$server" "$port" "rm -f /tmp/backup_cron.tmp"
            rm -f "$temp_cron"
            return 1
        fi
        
        # Проверяем, что crontab установлен
        if ! remote_exec "$server" "$port" "crontab -l | grep -q '$script_path'"; then
            log_error "Запись не добавлена в crontab после установки"
            rm -f "$temp_cron"
            return 1
        fi
        
        # Удаляем временный файл
        remote_exec "$server" "$port" "rm -f /tmp/backup_cron.tmp"
        
        log_info "Автоматические бэкапы настроены с частотой: $frequency"
    fi
    
    # Удаляем временный файл
    rm -f "$temp_cron"
    
    return 0
} 