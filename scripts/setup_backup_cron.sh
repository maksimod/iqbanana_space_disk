#!/bin/bash

# Скрипт для настройки cron-задания для резервного копирования
# Использование: ./setup_backup_cron.sh disk_uuid api_key api_url backup_path [interval]

# Проверка аргументов
if [ $# -lt 4 ]; then
    echo "Использование: $0 disk_uuid api_key api_url backup_path [interval]"
    echo "  disk_uuid   - UUID диска для бэкапа (должен совпадать с именем диска в базе данных)"
    echo "  api_key     - Ключ API для отправки статусов"
    echo "  api_url     - URL API сервера (например: http://localhost:6005)"
    echo "  backup_path - Путь для сохранения бэкапов"
    echo "  interval    - Интервал бэкапов (daily, weekly, monthly). По умолчанию: daily"
    exit 1
fi

DISK_UUID="$1"
API_KEY="$2"
API_URL="$3"
BACKUP_PATH="$4"
INTERVAL="${5:-daily}"

# Путь к скрипту make_backup.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/make_backup.sh"

# Проверка наличия скрипта для резервного копирования
if [ ! -f "$BACKUP_SCRIPT" ]; then
    echo "Ошибка: Скрипт $BACKUP_SCRIPT не найден"
    exit 1
fi

# Делаем скрипт исполняемым
chmod +x "$BACKUP_SCRIPT"

# Устанавливаем cron выражение в зависимости от интервала
case "$INTERVAL" in
    daily)
        # Ежедневно в 2:00
        CRON_EXPR="0 2 * * *"
        ;;
    weekly)
        # Еженедельно в воскресенье в 3:00
        CRON_EXPR="0 3 * * 0"
        ;;
    monthly)
        # Ежемесячно 1-го числа в 4:00
        CRON_EXPR="0 4 1 * *"
        ;;
    *)
        echo "Неизвестный интервал: $INTERVAL. Используем ежедневный бэкап."
        CRON_EXPR="0 2 * * *"
        ;;
esac

# Формируем команду для cron
BACKUP_CMD="$BACKUP_SCRIPT $DISK_UUID $BACKUP_PATH $API_KEY $API_URL $INTERVAL"

# Проверяем, существует ли уже задание для этого диска
EXISTING_CRON=$(crontab -l 2>/dev/null | grep -F "$DISK_UUID $BACKUP_PATH")

if [ -n "$EXISTING_CRON" ]; then
    # Обновляем существующее задание
    echo "Обновляем существующее cron-задание для диска $DISK_UUID"
    (crontab -l 2>/dev/null | grep -v "$DISK_UUID $BACKUP_PATH"; echo "$CRON_EXPR $BACKUP_CMD") | crontab -
else
    # Добавляем новое задание
    echo "Добавляем новое cron-задание для диска $DISK_UUID"
    (crontab -l 2>/dev/null; echo "$CRON_EXPR $BACKUP_CMD") | crontab -
fi

# Проверяем, добавилось ли задание
if crontab -l 2>/dev/null | grep -q "$DISK_UUID $BACKUP_PATH"; then
    echo "Cron-задание успешно установлено для диска $DISK_UUID с интервалом $INTERVAL"
    echo "Расписание: $CRON_EXPR"
    echo "Команда: $BACKUP_CMD"
else
    echo "Ошибка: Не удалось добавить cron-задание"
    exit 1
fi

exit 0 