#!/bin/bash

# Скрипт для восстановления резервных копий

# Загружаем конфигурацию и общие функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/backup_config.sh"
source "$SCRIPT_DIR/../nfs/common_functions.sh"

# Загружаем переменные окружения
if [ -f "$SCRIPT_DIR/../nfs/.env" ]; then
    source "$SCRIPT_DIR/../nfs/.env"
else
    echo "Ошибка: Файл .env не найден."
    exit 1
fi

# Используем значение из .env или дефолтное значение из конфигурации
SSH_HOST="${SSH_HOST:-$DEFAULT_SSH_HOST}"

# Используем порт из конфигурации
SERVER_PORT="$BACKUP_SERVER_PORT"

if [ -z "$SERVER_PORT" ]; then
    echo "Ошибка: Не указан SSH порт для сервера $BACKUP_SERVER в конфигурации."
    exit 1
fi

# Функция для записи в лог
log() {
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1" >> "$LOG_FILE"
    echo "$1"
}

# Проверка подключения к серверу
log "Проверка подключения к серверу $BACKUP_SERVER через порт $SERVER_PORT"
if ! check_server "$BACKUP_SERVER" "$SERVER_PORT"; then
    log "Ошибка: Не удалось подключиться к серверу $BACKUP_SERVER"
    exit 1
fi

# Получение списка доступных резервных копий
get_backups_command="ls -1 /mnt/backup_$TARGET_UUID/nfs_backup_*.tar.gz 2>/dev/null || echo 'Резервные копии не найдены'"
log "Получение списка доступных резервных копий с сервера $BACKUP_SERVER"
backup_list=$(remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$get_backups_command")

# Проверка наличия резервных копий
if echo "$backup_list" | grep -q "Резервные копии не найдены"; then
    log "На сервере $BACKUP_SERVER не найдены резервные копии"
    exit 1
fi

# Отображение списка резервных копий
echo "Доступные резервные копии:"
echo "$backup_list" | grep -v "успешно выполнена" | nl

# Запрос ввода пользователя
echo -n "Введите номер резервной копии для восстановления: "
read backup_number

# Проверка ввода
if ! [[ "$backup_number" =~ ^[0-9]+$ ]]; then
    log "Ошибка: Введен некорректный номер резервной копии"
    exit 1
fi

# Получение имени файла резервной копии
selected_backup=$(echo "$backup_list" | grep -v "успешно выполнена" | sed -n "${backup_number}p")

if [ -z "$selected_backup" ]; then
    log "Ошибка: Резервная копия с номером $backup_number не найдена"
    exit 1
fi

backup_filename=$(basename "$selected_backup")
log "Выбрана резервная копия: $backup_filename"

# Проверка и подготовка целевого диска для восстановления
prepare_target_disk_command="
# Проверка, существует ли точка монтирования
if [ ! -d /mnt/restore_$SOURCE_UUID ]; then
    sudo mkdir -p /mnt/restore_$SOURCE_UUID
    echo 'Создана точка монтирования /mnt/restore_$SOURCE_UUID'
else
    echo 'Точка монтирования /mnt/restore_$SOURCE_UUID уже существует'
fi

# Проверка и монтирование диска, если не смонтирован
if ! grep -q '/mnt/restore_$SOURCE_UUID' /proc/mounts; then
    sudo mount UUID=$SOURCE_UUID /mnt/restore_$SOURCE_UUID
    if [ \$? -eq 0 ]; then
        echo 'Диск успешно смонтирован в /mnt/restore_$SOURCE_UUID'
    else
        echo 'Ошибка монтирования диска'
        exit 1
    fi
else
    echo 'Диск уже смонтирован в /mnt/restore_$SOURCE_UUID'
fi
"
log "Подготовка целевого диска для восстановления на сервере $BACKUP_SERVER"
remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$prepare_target_disk_command"

# Выполнение восстановления резервной копии
restore_command="
echo 'Начало восстановления из $backup_filename...'

# Очистка целевого каталога перед восстановлением
echo 'Очистка целевого каталога...'
sudo rm -rf /mnt/restore_$SOURCE_UUID/* /mnt/restore_$SOURCE_UUID/.[!.]*

# Распаковка архива
echo 'Распаковка архива...'
sudo tar -xzf '$selected_backup' -C /mnt/restore_$SOURCE_UUID
if [ \$? -eq 0 ]; then
    echo 'Восстановление успешно завершено'
else
    echo 'Ошибка при восстановлении архива'
    exit 1
fi
"
log "Выполнение восстановления резервной копии на сервере $BACKUP_SERVER"
restore_result=$(remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$restore_command")

# Проверка результата восстановления
if echo "$restore_result" | grep -q "Восстановление успешно завершено"; then
    log "Резервная копия $backup_filename успешно восстановлена на сервере $BACKUP_SERVER"
    echo "Восстановление успешно завершено."
    exit 0
else
    log "Ошибка при восстановлении резервной копии $backup_filename на сервере $BACKUP_SERVER"
    echo "Произошла ошибка при восстановлении. Проверьте журнал для получения дополнительной информации."
    exit 1
fi 