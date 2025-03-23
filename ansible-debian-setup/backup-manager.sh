#!/bin/bash
# backup-manager.sh - Универсальный скрипт для управления бэкапами
# 
# Использование:
#   ./backup-manager.sh [опция]
#
# Опции:
#   rotate      - Ротация бэкапов (удаление старых)
#   create      - Создание нового бэкапа
#   restore     - Восстановление из бэкапа
#   status      - Проверка статуса бэкапов
#   help        - Показать справку

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Конфигурация
BACKUP_DIR="/home/apper/iqbanana-disk/backend/config"
CONFIG_FILE="$BACKUP_DIR/config.js"
BACKUP_PATTERN="config.js.backup.*"
MAX_BACKUPS=100
LOG_FILE="/var/log/backup-rotation.log"

# Дополнительные настройки для полного бэкапа
FULL_BACKUP_DIR="/var/backups/iqbanana-disk"
BACKUP_ITEMS=(
    "/home/apper/iqbanana-disk/backend/config"
    "/home/apper/iqbanana-disk/backend/controllers"
    "/home/apper/iqbanana-disk/backend/routes"
    "/home/apper/iqbanana-disk/frontend/src"
    "/home/apper/iqbanana-disk/docker-compose.yml"
)

# Функция логирования
log() {
    echo -e "$1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Инициализация системы логирования
init_log() {
    # Создаём лог-файл с правильными правами, если его нет
    mkdir -p /var/log
    touch "$LOG_FILE"
    chown apper:apper "$LOG_FILE" 2>/dev/null || true
    chmod 644 "$LOG_FILE" 2>/dev/null || true
    
    log "${BLUE}=== Запуск скрипта управления бэкапами ===${NC}"
}

# Проверка прав root для некоторых операций
check_root() {
    if [[ $EUID -ne 0 ]] && [ "$1" = "required" ]; then
        log "${RED}Этот скрипт должен быть запущен с правами root${NC}" 
        log "Пожалуйста, запустите: sudo $0 $*"
        exit 1
    fi
}

# Ротация бэкапов
rotate_backups() {
    log "${BLUE}=== Ротация бэкапов ===${NC}"
    
    # Проверяем существование директории с бэкапами
    if [ ! -d "$BACKUP_DIR" ]; then
        log "${RED}Каталог бэкапов $BACKUP_DIR не существует. Выход.${NC}"
        return 1
    fi
    
    # Подсчитываем количество существующих бэкапов
    BACKUP_COUNT=$(find "$BACKUP_DIR" -name "$BACKUP_PATTERN" -type f | wc -l)
    log "${YELLOW}Текущее количество бэкапов: $BACKUP_COUNT${NC}"
    
    # Если количество бэкапов превышает максимальное, удаляем самые старые
    if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
        # Количество файлов для удаления
        DELETE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
        
        # Находим самые старые файлы и удаляем их
        OLD_BACKUPS=$(find "$BACKUP_DIR" -name "$BACKUP_PATTERN" -type f | sort | head -n "$DELETE_COUNT")
        
        log "${YELLOW}Необходимо удалить $DELETE_COUNT старых бэкапов${NC}"
        
        while IFS= read -r old_file; do
            if [ -f "$old_file" ]; then
                rm "$old_file"
                log "${GREEN}Удален старый бэкап: $old_file${NC}"
            fi
        done <<< "$OLD_BACKUPS"
    else
        log "${GREEN}Количество бэкапов не превышает лимит ($MAX_BACKUPS), удаление не требуется${NC}"
    fi
    
    FINAL_COUNT=$(find "$BACKUP_DIR" -name "$BACKUP_PATTERN" -type f | wc -l)
    log "${GREEN}Итоговое количество бэкапов: $FINAL_COUNT${NC}"
    
    return 0
}

# Создание нового бэкапа
create_backup() {
    log "${BLUE}=== Создание нового бэкапа ===${NC}"
    
    # Проверяем существование директории с бэкапами
    if [ ! -d "$BACKUP_DIR" ]; then
        log "${YELLOW}Каталог бэкапов $BACKUP_DIR не существует. Создаем...${NC}"
        mkdir -p "$BACKUP_DIR"
    fi
    
    # Создаем бэкап только раз в час по умолчанию
    CURRENT_HOUR=$(date +%Y%m%d%H)
    LAST_BACKUP=$(find "$BACKUP_DIR" -name "config.js.backup.$CURRENT_HOUR*" -type f | head -n 1)
    
    if [ -z "$LAST_BACKUP" ] && [ -f "$CONFIG_FILE" ]; then
        # Если в текущем часе нет бэкапов, создаем новый
        BACKUP_FILE="$BACKUP_DIR/config.js.backup.$(date +%Y%m%d%H%M%S)"
        cp "$CONFIG_FILE" "$BACKUP_FILE"
        log "${GREEN}Создан новый бэкап: $BACKUP_FILE${NC}"
    else
        log "${YELLOW}Бэкап за текущий час уже существует или файл конфигурации отсутствует${NC}"
    fi
    
    # Если передан параметр --full, создать полный бэкап системы
    if [ "$1" = "--full" ]; then
        create_full_backup
    fi
    
    return 0
}

# Создание полного бэкапа
create_full_backup() {
    log "${BLUE}=== Создание полного бэкапа системы ===${NC}"
    
    # Создаем директорию для полных бэкапов, если она не существует
    mkdir -p "$FULL_BACKUP_DIR"
    
    # Имя архива с датой и временем
    ARCHIVE_NAME="$FULL_BACKUP_DIR/full_backup_$(date +%Y%m%d%H%M%S).tar.gz"
    
    # Создаем полный бэкап
    log "${YELLOW}Создание полного бэкапа в $ARCHIVE_NAME...${NC}"
    
    # Временная директория для сбора файлов
    TMP_DIR=$(mktemp -d)
    
    # Копируем все нужные файлы во временную директорию с сохранением структуры
    for item in "${BACKUP_ITEMS[@]}"; do
        if [ -e "$item" ]; then
            # Создаем директорию назначения
            mkdir -p "$TMP_DIR$(dirname $item)"
            # Копируем файлы или директории
            cp -a "$item" "$TMP_DIR$(dirname $item)/"
            log "${GREEN}Добавлен элемент: $item${NC}"
        else
            log "${RED}Элемент не найден: $item${NC}"
        fi
    done
    
    # Архивируем все элементы
    tar -czf "$ARCHIVE_NAME" -C "$TMP_DIR" .
    
    # Удаляем временную директорию
    rm -rf "$TMP_DIR"
    
    if [ -f "$ARCHIVE_NAME" ]; then
        log "${GREEN}Полный бэкап успешно создан: $ARCHIVE_NAME${NC}"
        log "${YELLOW}Размер бэкапа: $(du -h "$ARCHIVE_NAME" | cut -f1)${NC}"
    else
        log "${RED}Ошибка при создании полного бэкапа${NC}"
        return 1
    fi
    
    # Проверим количество полных бэкапов и удалим старые, если нужно
    FULL_BACKUP_COUNT=$(find "$FULL_BACKUP_DIR" -name "full_backup_*.tar.gz" | wc -l)
    
    if [ "$FULL_BACKUP_COUNT" -gt 10 ]; then
        log "${YELLOW}Обнаружено $FULL_BACKUP_COUNT полных бэкапов. Удаляем старые...${NC}"
        find "$FULL_BACKUP_DIR" -name "full_backup_*.tar.gz" -type f -printf "%T@ %p\n" | sort -n | head -n $(($FULL_BACKUP_COUNT - 10)) | cut -d' ' -f2- | xargs rm -f
        log "${GREEN}Старые полные бэкапы удалены${NC}"
    fi
    
    return 0
}

# Восстановление из бэкапа
restore_backup() {
    log "${BLUE}=== Восстановление из бэкапа ===${NC}"
    
    # Проверка существования директории бэкапов
    if [ ! -d "$BACKUP_DIR" ]; then
        log "${RED}Каталог бэкапов $BACKUP_DIR не существует.${NC}"
        return 1
    fi
    
    # Если указан конкретный файл для восстановления
    if [ -n "$1" ] && [ -f "$1" ]; then
        log "${YELLOW}Восстановление из файла: $1${NC}"
        
        # Создаем бэкап текущего файла перед восстановлением
        if [ -f "$CONFIG_FILE" ]; then
            cp "$CONFIG_FILE" "$CONFIG_FILE.before_restore.$(date +%Y%m%d%H%M%S)"
            log "${GREEN}Создан бэкап текущего файла: $CONFIG_FILE.before_restore.$(date +%Y%m%d%H%M%S)${NC}"
        fi
        
        cp "$1" "$CONFIG_FILE"
        log "${GREEN}Файл успешно восстановлен из $1${NC}"
        return 0
    fi
    
    # Если не указан конкретный файл, показываем список доступных бэкапов
    log "${YELLOW}Доступные бэкапы:${NC}"
    
    # Получаем список бэкапов и нумеруем их
    mapfile -t BACKUPS < <(find "$BACKUP_DIR" -name "$BACKUP_PATTERN" -type f | sort -r)
    
    if [ ${#BACKUPS[@]} -eq 0 ]; then
        log "${RED}Нет доступных бэкапов для восстановления.${NC}"
        return 1
    fi
    
    for i in "${!BACKUPS[@]}"; do
        backup_file="${BACKUPS[$i]}"
        backup_date=$(echo "$backup_file" | grep -o '[0-9]\{14\}')
        formatted_date=$(date -d "${backup_date:0:8} ${backup_date:8:2}:${backup_date:10:2}:${backup_date:12:2}" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "Неизвестная дата")
        log "[$i] $formatted_date - $(basename "$backup_file")"
    done
    
    # Предложение выбрать бэкап для восстановления
    read -p "Введите номер бэкапа для восстановления (или 'q' для отмены): " choice
    
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -lt "${#BACKUPS[@]}" ]; then
        selected_backup="${BACKUPS[$choice]}"
        log "${YELLOW}Выбран бэкап: $selected_backup${NC}"
        
        # Создаем бэкап текущего файла перед восстановлением
        if [ -f "$CONFIG_FILE" ]; then
            cp "$CONFIG_FILE" "$CONFIG_FILE.before_restore.$(date +%Y%m%d%H%M%S)"
            log "${GREEN}Создан бэкап текущего файла: $CONFIG_FILE.before_restore.$(date +%Y%m%d%H%M%S)${NC}"
        fi
        
        cp "$selected_backup" "$CONFIG_FILE"
        log "${GREEN}Файл успешно восстановлен из бэкапа${NC}"
    else
        log "${YELLOW}Восстановление отменено${NC}"
    fi
    
    return 0
}

# Проверка статуса бэкапов
check_status() {
    log "${BLUE}=== Статус бэкапов ===${NC}"
    
    log "${YELLOW}Конфигурация:${NC}"
    log "Директория бэкапов: $BACKUP_DIR"
    log "Файл конфигурации: $CONFIG_FILE"
    log "Максимальное количество бэкапов: $MAX_BACKUPS"
    log "Лог-файл: $LOG_FILE"
    
    # Проверка существования директории и файла конфигурации
    if [ ! -d "$BACKUP_DIR" ]; then
        log "${RED}Директория бэкапов не существует${NC}"
    else
        log "${GREEN}Директория бэкапов существует${NC}"
    fi
    
    if [ ! -f "$CONFIG_FILE" ]; then
        log "${RED}Файл конфигурации не существует${NC}"
    else
        log "${GREEN}Файл конфигурации существует${NC}"
        log "Последнее изменение: $(stat -c "%y" "$CONFIG_FILE")"
    fi
    
    # Проверка количества бэкапов
    BACKUP_COUNT=$(find "$BACKUP_DIR" -name "$BACKUP_PATTERN" -type f | wc -l)
    log "${YELLOW}Количество бэкапов: $BACKUP_COUNT${NC}"
    
    if [ "$BACKUP_COUNT" -gt 0 ]; then
        # Самый новый бэкап
        NEWEST_BACKUP=$(find "$BACKUP_DIR" -name "$BACKUP_PATTERN" -type f -printf "%T@ %p\n" | sort -n | tail -n 1 | cut -d' ' -f2-)
        NEWEST_TIME=$(stat -c "%y" "$NEWEST_BACKUP")
        log "${GREEN}Самый новый бэкап: $(basename "$NEWEST_BACKUP") (создан $NEWEST_TIME)${NC}"
        
        # Самый старый бэкап
        OLDEST_BACKUP=$(find "$BACKUP_DIR" -name "$BACKUP_PATTERN" -type f -printf "%T@ %p\n" | sort -n | head -n 1 | cut -d' ' -f2-)
        OLDEST_TIME=$(stat -c "%y" "$OLDEST_BACKUP")
        log "${YELLOW}Самый старый бэкап: $(basename "$OLDEST_BACKUP") (создан $OLDEST_TIME)${NC}"
    fi
    
    # Проверка полных бэкапов
    if [ -d "$FULL_BACKUP_DIR" ]; then
        FULL_BACKUP_COUNT=$(find "$FULL_BACKUP_DIR" -name "full_backup_*.tar.gz" | wc -l)
        log "${YELLOW}Количество полных бэкапов: $FULL_BACKUP_COUNT${NC}"
        
        if [ "$FULL_BACKUP_COUNT" -gt 0 ]; then
            # Самый новый полный бэкап
            NEWEST_FULL=$(find "$FULL_BACKUP_DIR" -name "full_backup_*.tar.gz" -printf "%T@ %p\n" | sort -n | tail -n 1 | cut -d' ' -f2-)
            NEWEST_FULL_TIME=$(stat -c "%y" "$NEWEST_FULL")
            NEWEST_FULL_SIZE=$(du -h "$NEWEST_FULL" | cut -f1)
            log "${GREEN}Самый новый полный бэкап: $(basename "$NEWEST_FULL") (создан $NEWEST_FULL_TIME, размер $NEWEST_FULL_SIZE)${NC}"
        fi
    else
        log "${YELLOW}Директория для полных бэкапов не существует${NC}"
    fi
    
    # Проверка настроек cron для бэкапов
    log "${YELLOW}Настройки cron для бэкапов:${NC}"
    crontab -l 2>/dev/null | grep -E "backup|rotate" || log "${RED}Настройки cron для бэкапов не найдены${NC}"
    
    return 0
}

# Вывод справки
show_help() {
    log "${BLUE}=== Справка по скрипту backup-manager.sh ===${NC}"
    log "Использование:"
    log "  ./backup-manager.sh [опция]"
    log ""
    log "Опции:"
    log "  rotate          - Ротация бэкапов (удаление старых)"
    log "  create          - Создание нового бэкапа конфигурации"
    log "  create --full   - Создание полного бэкапа системы"
    log "  restore [файл]  - Восстановление из бэкапа (если файл не указан, будет показан список)"
    log "  status          - Проверка статуса бэкапов"
    log "  help            - Показать эту справку"
    log ""
    log "Примеры:"
    log "  ./backup-manager.sh create       # Создание нового бэкапа конфигурации"
    log "  ./backup-manager.sh create --full # Создание полного бэкапа"
    log "  ./backup-manager.sh restore      # Восстановление (с выбором из списка)"
    log ""
    return 0
}

# Основная функция
main() {
    local action="$1"
    shift
    
    # Инициализация логирования
    init_log
    
    case "$action" in
        rotate)
            check_root
            rotate_backups
            ;;
        create)
            check_root
            create_backup "$1"
            ;;
        restore)
            check_root required
            restore_backup "$1"
            ;;
        status)
            check_status
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

main "$@"
exit $? 