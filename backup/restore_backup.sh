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

# Жестко задаем порт для подключения - исправляет проблему с портом
SERVER_PORT="2222"

# Проверка подключения к серверу
echo "Проверка подключения к серверу $BACKUP_SERVER через порт $SERVER_PORT"
if ! check_server "$BACKUP_SERVER" "$SERVER_PORT"; then
    echo "Ошибка: Не удалось подключиться к серверу $BACKUP_SERVER"
    exit 1
fi

# Используем фиксированный путь к директории бэкапа
echo "Определение директории с бэкапами..."
BACKUP_DIR="/mnt/backup_ae3ff395-3049-4ec8-8524-3ed631eb4a46"

# Получаем файлы бэкапов
echo "Получение списка файлов бэкапов..."

# Используем простой подход, который вернет только уникальные имена файлов без дублирования
backup_command="ls -1 $BACKUP_DIR/*.tar.gz 2>/dev/null | sort | uniq"
output=$(remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$backup_command")

# Извлекаем только имена файлов (без пути) и убираем дубликаты
backup_files=$(echo "$output" | grep -o '[^/]*\.tar\.gz$' | sort -u)

# Проверяем, что файлы бэкапов найдены
if [ -z "$backup_files" ]; then
    echo "В директории $BACKUP_DIR не найдены файлы резервных копий"
    exit 1
fi

# Выводим список бэкапов с номерами
echo "Доступные резервные копии:"
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
    echo "Автоматически выбрана единственная доступная резервная копия."
else
    # Запрашиваем выбор пользователя
    echo -n "Введите номер резервной копии для восстановления: "
    read backup_number

    # Проверяем ввод
    if ! [[ "$backup_number" =~ ^[0-9]+$ ]]; then
        echo "Ошибка: Введен некорректный номер"
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
    echo "Ошибка: Резервная копия с номером $backup_number не найдена"
    exit 1
fi

echo "Выбрана резервная копия: $(basename "$selected_backup")"

# Подготовка целевого диска для восстановления
echo "Подготовка целевого диска для восстановления..."
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
remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$prepare_command"

# Восстановление бэкапа
echo "Начало восстановления из $(basename "$selected_backup")..."
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
restore_result=$(remote_exec "$BACKUP_SERVER" "$SERVER_PORT" "$restore_command")

# Проверка результата
if echo "$restore_result" | grep -q "Восстановление успешно завершено"; then
    echo "Резервная копия успешно восстановлена!"
    echo "Восстановлены файлы:"
    echo "$restore_result" | grep -A 100 "Восстановление успешно завершено"
    exit 0
else
    echo "Произошла ошибка при восстановлении:"
    echo "$restore_result"
    exit 1
fi 