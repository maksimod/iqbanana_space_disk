#!/bin/bash

# Подключаем функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "${SCRIPT_DIR}/backup_functions.sh"

# Загружаем конфигурацию
load_config

# Проверяем аргументы
if [ $# -eq 1 ]; then
    # Пользователь указал имя бэкапа
    BACKUP_NAME="$1"
fi

# Проверяем доступность сервера
for port_entry in "${SSH_PORTS[@]}"; do
    server=$(echo $port_entry | cut -d':' -f1)
    port=$(echo $port_entry | cut -d':' -f2)
    
    if [[ "$server" == "$BACKUP_SERVER" ]]; then
        server_port=$port
        break
    fi
done

if [ -z "$server_port" ]; then
    log_error "Не найден порт для сервера $BACKUP_SERVER в SSH_PORTS"
    exit 1
fi

# Проверяем доступность сервера
if ! check_server "$BACKUP_SERVER" "$server_port"; then
    log_error "Сервер $BACKUP_SERVER недоступен"
    exit 1
fi

log_info "Сервер $BACKUP_SERVER доступен."

# Определяем путь для репозитория Borg
REPO_PATH="${TARGET_MOUNT}/${REPO_NAME}"

# Получаем список бэкапов, если имя не указано
if [ -z "$BACKUP_NAME" ]; then
    log_info "Получение списка доступных бэкапов..."
    
    # Получаем список бэкапов
    BACKUPS=$(remote_exec "$BACKUP_SERVER" "$server_port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg list $REPO_PATH")
    
    if [ -z "$BACKUPS" ]; then
        log_error "Не найдено ни одного бэкапа в репозитории $REPO_PATH"
        exit 1
    fi
    
    # Выводим список бэкапов
    echo "Доступные бэкапы:"
    echo "$BACKUPS"
    echo ""
    
    # Запрашиваем у пользователя, какой бэкап восстановить
    echo -n "Введите имя бэкапа для восстановления: "
    read BACKUP_NAME
    
    if [ -z "$BACKUP_NAME" ]; then
        log_error "Не указано имя бэкапа для восстановления"
        exit 1
    fi
fi

# Проверяем существование бэкапа
if ! remote_exec "$BACKUP_SERVER" "$server_port" "BORG_PASSPHRASE='$BORG_PASSPHRASE' borg list $REPO_PATH::$BACKUP_NAME" &>/dev/null; then
    log_error "Бэкап $BACKUP_NAME не существует в репозитории $REPO_PATH"
    exit 1
fi

# Запрашиваем подтверждение
echo ""
echo "ВНИМАНИЕ! Восстановление полностью перезапишет содержимое диска /dev/$SOURCE_DISK!"
echo "Все данные на диске будут потеряны и заменены данными из бэкапа $BACKUP_NAME."
echo ""
echo -n "Вы уверены, что хотите продолжить? (y/n): "
read CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    log_info "Восстановление отменено пользователем"
    exit 0
fi

# Восстанавливаем бэкап
log_info "Начинаем восстановление бэкапа $BACKUP_NAME на диск /dev/$SOURCE_DISK"

if ! restore_backup "$BACKUP_SERVER" "$server_port" "$SOURCE_DISK" "$REPO_PATH" "$BACKUP_NAME"; then
    log_error "Не удалось восстановить бэкап $BACKUP_NAME на диск /dev/$SOURCE_DISK"
    exit 1
fi

log_info "Бэкап $BACKUP_NAME успешно восстановлен на диск /dev/$SOURCE_DISK" 