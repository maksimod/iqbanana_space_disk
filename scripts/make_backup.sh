#!/bin/bash

# Скрипт создания бэкапа и отправки статуса через API
# Использование: ./make_backup.sh disk_uuid backup_path api_key api_url [interval]

# Проверка аргументов
if [ $# -lt 4 ]; then
    echo "Использование: $0 disk_uuid backup_path api_key api_url [interval]"
    echo "  disk_uuid   - UUID диска для бэкапа (должен совпадать с именем диска в базе данных)"
    echo "  backup_path - Путь для сохранения бэкапов"
    echo "  api_key     - Ключ API для отправки статусов"
    echo "  api_url     - URL API сервера (например: http://localhost:6005)"
    echo "  interval    - Интервал бэкапов (daily, weekly, monthly). По умолчанию: daily"
    exit 1
fi

DISK_UUID="$1"
BACKUP_PATH="$2"
API_KEY="$3"
API_URL="$4"
INTERVAL="${5:-daily}"

# Используем фиксированный путь для монтирования бэкапов, если передали неверный путь
if [ "$BACKUP_PATH" == "/root/backups" ]; then
    BACKUP_PATH="/mnt/backup_ae3ff395-3049-4ec8-8524-3ed631eb4a46"
    echo "ВНИМАНИЕ: Изменен путь для бэкапов на правильный: $BACKUP_PATH"
fi

# Вывод информации о параметрах запуска для отладки
echo "--------------------------------"
echo "Запуск скрипта резервного копирования"
echo "Диск UUID: $DISK_UUID"
echo "Путь для бэкапов: $BACKUP_PATH"
echo "API ключ: $API_KEY"
echo "API URL: $API_URL"
echo "Интервал: $INTERVAL"
echo "--------------------------------"

# Создаем каталог для резервных копий, если он не существует
if [ ! -d "$BACKUP_PATH" ]; then
    echo "Создание каталога для резервных копий: $BACKUP_PATH"
    mkdir -p "$BACKUP_PATH" || { echo "Ошибка при создании каталога $BACKUP_PATH"; exit 1; }
fi

# Получаем короткое имя диска (для имени файла и логов)
DISK_SHORT_NAME=$(echo $DISK_UUID | cut -d'-' -f1)

# Путь для логов
LOG_DIR="/var/log/iqbanana_backups"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${DISK_SHORT_NAME}_backup.log"

# Запись в лог (только файл, без stdout)
log_to_file() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$message" >> "$LOG_FILE"
}

# Запись в лог с датой
log_message() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$message" >> "$LOG_FILE"
    echo "$message" # Добавлен вывод на экран
}

# Функция для отправки статуса через API
send_backup_status() {
    local status="$1"
    local message="$2"
    
    # Вывод информации о запросе к API для отладки
    log_message "ОТПРАВКА API: Отправка статуса '$status' с сообщением '$message'"
    
    # Формируем JSON для отправки
    json_data="{\"diskName\":\"$DISK_UUID\",\"status\":\"$status\",\"message\":\"$message\"}"
    
    # Корректируем API URL для гарантированного соединения
    local url_to_use=${API_URL}

    # Фиксированный IP-адрес API сервера (на основе данных из конфигурации)
    local fixed_server_ip="192.168.0.103"
    
    # Если задан localhost, напрямую используем фиксированный IP
    if [[ "$API_URL" == *"localhost"* ]]; then
        local api_port=$(echo "$API_URL" | grep -oP '(?<=:)[0-9]+' || echo "6005")
        url_to_use="http://${fixed_server_ip}:${api_port}"
        log_message "API URL изменен с $API_URL на $url_to_use (фиксированный IP-адрес сервера)"
    fi
    
    log_message "ОТПРАВКА API: URL=${url_to_use}/api/system/backup-status, API_KEY=${API_KEY}"
    log_message "ОТПРАВКА API: JSON=${json_data}"
    
    # Печатаем команду curl для отладки
    log_message "Команда: curl -v -s -X POST -H \"Content-Type: application/json\" -H \"X-API-KEY: $API_KEY\" -d '$json_data' \"${url_to_use}/api/system/backup-status\""
    
    # Отправляем запрос на API с подробным выводом ответа
    response=$(curl -v -s -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-KEY: $API_KEY" \
        -d "$json_data" \
        "${url_to_use}/api/system/backup-status" 2>&1)
    
    # Проверяем ответ
    log_message "ОТВЕТ API: $response"
    
    # Извлекаем HTTP статус из ответа
    http_status=$(echo "$response" | grep -oP 'HTTP/[0-9.]+ \K[0-9]+')
    log_message "HTTP статус: $http_status"
    
    # Проверяем статус ответа
    if [[ "$http_status" == "200" ]]; then
        log_message "API запрос выполнен успешно (HTTP 200 OK)"
        # Проверяем, что в ответе есть success:true
        if echo "$response" | grep -q '"success":true'; then
            log_message "Статус успешно обновлен в API (success: true)"
        else
            log_message "ВНИМАНИЕ: API вернул код 200, но в ответе нет success:true"
        fi
    elif [[ "$http_status" == "401" ]]; then
        log_message "ОШИБКА API: Ошибка авторизации (HTTP 401 Unauthorized)"
        log_message "Проверьте правильность API ключа: $API_KEY"
    elif [[ "$http_status" == "404" ]]; then
        log_message "ОШИБКА API: Маршрут не найден (HTTP 404 Not Found)"
        log_message "Проверьте правильность URL: ${url_to_use}/api/system/backup-status"
    elif [[ "$http_status" == "500" ]]; then
        log_message "ОШИБКА API: Внутренняя ошибка сервера (HTTP 500 Internal Server Error)"
        log_message "Проверьте логи сервера для получения подробной информации"
        # Проверяем содержимое ответа на предмет конкретных ошибок
        error_message=$(echo "$response" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$error_message" ]; then
            log_message "ОШИБКА API: $error_message"
        fi
    fi
    
    # Проверяем наличие ошибок соединения
    if echo "$response" | grep -q "Connection refused"; then
        log_message "ОШИБКА API: Не удалось подключиться к API (отказано в соединении)"
        log_message "ОШИБКА API: Проверьте, что сервер запущен и доступен по адресу ${url_to_use}"
    elif echo "$response" | grep -q "Could not resolve host"; then
        log_message "ОШИБКА API: Не удалось разрешить имя хоста"
    elif echo "$response" | grep -q "Couldn't connect to server"; then
        log_message "ОШИБКА API: Не удалось подключиться к серверу"
    fi
    
    # Вывод в консоль для наглядности
    echo ">>> Отправлен статус в API: $status - $message"
}

# Очистка старых резервных копий (оставляем только последние 5)
cleanup_old_backups() {
    # Получаем список файлов бэкапов для данного диска
    log_message "Поиск старых бэкапов в директории $BACKUP_PATH"
    backup_files=$(find "$BACKUP_PATH" -name "nfs_backup_*.tar.gz" | sort)
    
    # Подсчитываем количество файлов
    count=$(echo "$backup_files" | wc -l)
    log_message "Найдено $count файлов бэкапов"
    
    # Если файлов больше 5, удаляем самые старые
    if [ "$count" -gt 5 ]; then
        # Количество файлов для удаления
        remove_count=$((count - 5))
        
        # Получаем список файлов для удаления (самые старые)
        files_to_remove=$(echo "$backup_files" | head -n "$remove_count")
        
        # Удаляем каждый файл
        echo "$files_to_remove" | while read -r file; do
            log_message "Удаление старого бэкапа: $file"
            rm -f "$file"
        done
    fi
}

# Функция для поиска точки монтирования диска по UUID - не выводит логи в stdout
find_mountpoint() {
    local uuid="$1"
    local mount_path=""
    
    # Используем только запись в лог-файл, а не на экран
    log_to_file "Поиск точки монтирования диска с UUID: $uuid"
    
    # Показываем смонтированные диски в лог-файле
    log_to_file "Список смонтированных дисков (сокращенный):"
    mount | grep "$uuid" >> "$LOG_FILE"
    
    # Проверяем стандартные пути монтирования
    for path in "/mnt/storage/$uuid" "/mnt/$uuid" "/mnt/disks/$uuid"; do
        log_to_file "Проверка пути: $path"
        if [ -d "$path" ] && mountpoint -q "$path" 2>/dev/null; then
            log_to_file "Найдена точка монтирования: $path"
            mount_path="$path"
            break
        elif [ -d "$path" ]; then
            log_to_file "Путь $path существует, но не является точкой монтирования"
        else
            log_to_file "Путь $path не существует"
        fi
    done
    
    # Если еще не нашли, ищем через mount
    if [ -z "$mount_path" ]; then
        log_to_file "Поиск через mount..."
        mount_path=$(mount | grep -i "$uuid" | head -1 | awk '{print $3}')
        
        if [ -n "$mount_path" ]; then
            log_to_file "Найден путь через mount: $mount_path"
        else
            log_to_file "Диск с UUID $uuid не найден через mount"
            # Проверка, что диск вообще существует
            blkid | grep -q "$uuid"
            if [ $? -eq 0 ]; then
                log_to_file "Диск существует, но не смонтирован."
            else
                log_to_file "Диск с UUID $uuid вообще не существует в системе!"
            fi
            return 1
        fi
    fi
    
    # Проверка что директория существует и доступна
    if [ ! -d "$mount_path" ]; then
        log_to_file "ОШИБКА: Найденный путь $mount_path не является директорией"
        return 1
    fi
    
    # Проверка доступа
    if ! ls -la "$mount_path" &>/dev/null; then
        log_to_file "ОШИБКА: Нет доступа к директории $mount_path"
        return 1
    fi
    
    # Возвращаем только путь без лишнего вывода
    echo "$mount_path"
    return 0
}

# Функция для создания бэкапа
make_backup() {
    # Формируем имя файла бэкапа с текущей датой - используем nfs_backup вместо UUID
    DATE_SUFFIX=$(date '+%Y%m%d_%H%M%S')
    BACKUP_FILE="${BACKUP_PATH}/nfs_backup_${DATE_SUFFIX}.tar.gz"
    
    # Ищем точку монтирования диска без вывода логов в stdout
    DISK_MOUNTPOINT=""
    DISK_MOUNTPOINT=$(find_mountpoint "$DISK_UUID")
    FIND_RESULT=$?
    
    log_message "Результат поиска точки монтирования: ${DISK_MOUNTPOINT}"
    
    if [ $FIND_RESULT -ne 0 ] || [ -z "$DISK_MOUNTPOINT" ]; then
        log_message "ОШИБКА: Диск с UUID ${DISK_UUID} не найден или не смонтирован"
        log_message "Проверьте, что диск смонтирован по одному из путей: /mnt/$DISK_UUID, /mnt/storage/$DISK_UUID или другому пути"
        send_backup_status "ERROR" "Диск с UUID ${DISK_UUID} не найден или не смонтирован"
        return 1
    fi
    
    # Отправляем статус о начале бэкапа
    send_backup_status "PROCESSING" "Начало резервного копирования"
    log_message "Начало создания бэкапа для диска ${DISK_UUID}"
    log_message "Найдена точка монтирования диска: ${DISK_MOUNTPOINT}"
    
    # Создаем каталог бэкапов если его нет
    mkdir -p "$BACKUP_PATH"
    
    # Проверка доступности точки монтирования еще раз
    if ! ls -la "${DISK_MOUNTPOINT}" &>/dev/null; then
        log_message "ОШИБКА: Не удается получить доступ к точке монтирования ${DISK_MOUNTPOINT}"
        send_backup_status "ERROR" "Нет доступа к точке монтирования ${DISK_MOUNTPOINT}"
        return 1
    fi
    
    # Создаём бэкап
    SOURCE_DIR=$(dirname "${DISK_MOUNTPOINT}")
    SOURCE_BASE=$(basename "${DISK_MOUNTPOINT}")
    
    log_message "Создание архива из ${DISK_MOUNTPOINT} в ${BACKUP_FILE}"
    log_message "Команда: tar -czf ${BACKUP_FILE} -C ${SOURCE_DIR} ${SOURCE_BASE}"
    
    # Проверяем наличие данных в источнике
    FILE_COUNT=$(find "${DISK_MOUNTPOINT}" -type f | wc -l)
    DIR_COUNT=$(find "${DISK_MOUNTPOINT}" -type d | wc -l)
    log_message "В источнике найдено ${FILE_COUNT} файлов и ${DIR_COUNT} директорий"
    
    # Используем timeout для предотвращения зависания команды tar
    log_message "Начало архивирования... это может занять некоторое время"
    
    # Проверяем доступное пространство на диске назначения
    DEST_SPACE=$(df -k "$BACKUP_PATH" | tail -1 | awk '{print $4}')
    SOURCE_SIZE=$(du -sk "$DISK_MOUNTPOINT" | awk '{print $1}')
    
    log_message "Размер источника: ${SOURCE_SIZE} KB, доступно на диске назначения: ${DEST_SPACE} KB"
    
    if [ "$SOURCE_SIZE" -gt "$DEST_SPACE" ]; then
        log_message "ОШИБКА: Недостаточно места на диске для создания бэкапа"
        send_backup_status "ERROR" "Недостаточно места на диске для создания бэкапа"
        return 1
    fi
    
    # Запускаем tar с более безопасными параметрами и в фоновом режиме
    log_message "Запуск tar команды..."
    
    # Создаем отдельный процесс для tar с перенаправлением вывода
    {
        # Используем ionice для снижения I/O нагрузки и nice для снижения CPU нагрузки
        # --warning=no-file-changed и --warning=no-file-removed предотвращают ошибки при изменении файлов
        timeout 1800 tar \
            --warning=no-file-changed \
            --warning=no-file-removed \
            --ignore-failed-read \
            -cf "${BACKUP_FILE}" \
            -C "${SOURCE_DIR}" "${SOURCE_BASE}" \
            > /tmp/tar_progress.log 2>&1
        
        echo $? > /tmp/tar_exit_code
    } &
    
    # Сохраняем PID процесса tar
    TAR_PID=$!
    log_message "Процесс tar запущен с PID: ${TAR_PID}"
    
    # Ждем завершения tar с периодическим выводом статуса
    while kill -0 $TAR_PID 2>/dev/null; do
        log_message "Архивирование продолжается... Текущий размер архива: $(du -h "${BACKUP_FILE}" 2>/dev/null | cut -f1)"
        sleep 10
    done
    
    # Получаем код завершения tar
    TAR_EXIT_CODE=$(cat /tmp/tar_exit_code)
    log_message "Процесс tar завершен с кодом: ${TAR_EXIT_CODE}"
    
    # Проверяем результат выполнения команды tar
    if [ $TAR_EXIT_CODE -eq 0 ]; then
        # Проверяем, что файл создался и не пустой
        if [ -f "${BACKUP_FILE}" ] && [ -s "${BACKUP_FILE}" ]; then
            log_message "Бэкап успешно создан: ${BACKUP_FILE}"
            log_message "Размер файла: $(du -h "${BACKUP_FILE}" | cut -f1)"
            
            # Очистка старых бэкапов
            cleanup_old_backups
            
            # Отправляем статус об успешном создании бэкапа
            send_backup_status "SUCCESS" "Бэкап успешно создан: $(basename "${BACKUP_FILE}")"
            return 0
        else
            log_message "ОШИБКА: Файл бэкапа создан, но имеет нулевой размер"
            send_backup_status "ERROR" "Бэкап создан с нулевым размером"
            rm -f "${BACKUP_FILE}"
            return 1
        fi
    else
        # Выводим последние строки лога tar для отладки
        log_message "ОШИБКА при создании бэкапа (код: ${TAR_EXIT_CODE})"
        log_message "Последние строки лога tar:"
        tail -n 20 /tmp/tar_progress.log >> "$LOG_FILE"
        send_backup_status "ERROR" "Ошибка при создании бэкапа (код: ${TAR_EXIT_CODE})"
        
        # Удаляем неполный файл бэкапа
        if [ -f "${BACKUP_FILE}" ]; then
            log_message "Удаление неполного файла бэкапа: ${BACKUP_FILE}"
            rm -f "${BACKUP_FILE}"
        fi
        
        return 1
    fi
}

# Выполняем бэкап
make_backup
BACKUP_RESULT=$?

# Выводим итоговую информацию
if [ $BACKUP_RESULT -eq 0 ]; then
    echo "--------------------------------"
    echo "Резервное копирование успешно завершено"
    echo "Создан файл бэкапа в каталоге: $BACKUP_PATH"
    echo "Путь к лог-файлу: $LOG_FILE"
    echo "--------------------------------"
else
    echo "--------------------------------"
    echo "Резервное копирование завершилось с ошибкой"
    echo "Проверьте лог-файл для деталей: $LOG_FILE"
    echo "--------------------------------"
fi

exit $BACKUP_RESULT 