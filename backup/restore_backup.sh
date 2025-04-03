#!/bin/bash

# Скрипт для восстановления резервных копий

# Загружаем конфигурацию
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/backup_config.sh"

# Функция для записи в лог
log() {
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1"
    echo "$1"
}

# Проверка наличия ключа SSH
if [ ! -f "$SSH_KEY_PATH" ]; then
    log "Ошибка: SSH ключ $SSH_KEY_PATH не найден."
    log "Пожалуйста, запустите скрипт set_ssh.sh для настройки SSH соединения."
    exit 1
fi

# Проверка подключения к серверу
log "Проверка подключения к серверу $BACKUP_SERVER через порт $BACKUP_SERVER_PORT"
if ! ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -p "$BACKUP_SERVER_PORT" "root@$BACKUP_SERVER" "echo 'Подключение работает'"; then
    log "Ошибка: Не удалось подключиться к серверу $BACKUP_SERVER"
    exit 1
fi

# Используем фиксированный путь к директории бэкапа
log "Определение директории с бэкапами..."
BACKUP_DIR="/mnt/backup_ae3ff395-3049-4ec8-8524-3ed631eb4a46"

# Получаем файлы бэкапов
log "Получение списка файлов бэкапов..."

# Используем простой подход, который вернет только уникальные имена файлов без дублирования
backup_files=$(ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" "root@$BACKUP_SERVER" "ls -1 $BACKUP_DIR/*.tar.gz 2>/dev/null | sort | uniq")

# Извлекаем только имена файлов (без пути) и убираем дубликаты
backup_files=$(echo "$backup_files" | grep -o '[^/]*\.tar\.gz$' | sort -u)

# Проверяем, что файлы бэкапов найдены
if [ -z "$backup_files" ]; then
    log "В директории $BACKUP_DIR не найдены файлы резервных копий"
    exit 1
fi

# Выводим список бэкапов с номерами
log "Доступные резервные копии:"
i=1
while read -r backup_file; do
    # Фильтруем только реальные имена файлов бэкапов
    if [[ "$backup_file" =~ \.tar\.gz$ ]]; then
        echo "$i) $backup_file"
        i=$((i+1))
    fi
done <<< "$backup_files"

# Подсчитываем количество реально найденных бэкапов
real_backup_count=$(echo "$backup_files" | grep -c "\.tar\.gz$")

# Если найдена только одна резервная копия, устанавливаем её по умолчанию
if [ "$real_backup_count" -eq 1 ]; then
    backup_number=1
    backup_filename=$(echo "$backup_files" | grep "\.tar\.gz$")
    selected_backup="$BACKUP_DIR/$backup_filename"
    log "Автоматически выбрана единственная доступная резервная копия."
else
    # Запрашиваем выбор пользователя
    echo -n "Введите номер резервной копии для восстановления: "
    read backup_number

    # Проверяем ввод
    if ! [[ "$backup_number" =~ ^[0-9]+$ ]]; then
        log "Ошибка: Введен некорректный номер"
        exit 1
    fi

    # Получаем выбранный файл
    i=1
    backup_filename=""
    while read -r backup_file; do
        # Фильтруем только реальные имена файлов бэкапов
        if [[ "$backup_file" =~ \.tar\.gz$ ]]; then
            if [ $i -eq $backup_number ]; then
                backup_filename="$backup_file"
                break
            fi
            i=$((i+1))
        fi
    done <<< "$backup_files"
    
    # Формируем полный путь к файлу
    if [ -n "$backup_filename" ]; then
        selected_backup="$BACKUP_DIR/$backup_filename"
    else
        selected_backup=""
    fi
fi

if [ -z "$selected_backup" ]; then
    log "Ошибка: Резервная копия с номером $backup_number не найдена"
    exit 1
fi

log "Выбрана резервная копия: $(basename "$selected_backup")"

# Подготовка целевого диска для восстановления
log "Подготовка целевого диска для восстановления..."
prepare_command="
# Проверяем существование директории
if [ ! -d /mnt/storage/sdb ]; then
    sudo mkdir -p /mnt/storage/sdb
    echo 'Создана директория /mnt/storage/sdb'
else
    echo 'Директория /mnt/storage/sdb уже существует'
fi

# Проверяем, смонтирован ли диск
if ! grep -q '/mnt/storage/sdb' /proc/mounts; then
    sudo mount UUID=$SOURCE_UUID /mnt/storage/sdb
    if [ \$? -eq 0 ]; then
        echo 'Диск успешно смонтирован'
    else
        echo 'Ошибка монтирования диска'
        exit 1
    fi
else
    echo 'Диск уже смонтирован'
fi
"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" "root@$BACKUP_SERVER" "$prepare_command"

# Восстановление бэкапа
log "Начало восстановления из $(basename "$selected_backup")..."
restore_command="
# Очистка целевого каталога
echo 'Очистка целевого каталога...'
sudo rm -rf /mnt/storage/sdb/* /mnt/storage/sdb/.[!.]*

# Распаковка архива
echo 'Распаковка архива...'
sudo tar -xzf \"$selected_backup\" -C /mnt/storage/sdb
if [ \$? -eq 0 ]; then
    echo 'Восстановление успешно завершено'
    ls -la /mnt/storage/sdb/
else
    echo 'Ошибка при восстановлении архива'
    exit 1
fi
"
restore_result=$(ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" "root@$BACKUP_SERVER" "$restore_command")

# Проверка результата
if echo "$restore_result" | grep -q "Восстановление успешно завершено"; then
    log "Резервная копия успешно восстановлена!"
    log "Восстановлены файлы:"
    echo "$restore_result" | grep -A 100 "Восстановление успешно завершено"
    exit 0
else
    log "Произошла ошибка при восстановлении:"
    echo "$restore_result"
    exit 1
fi 