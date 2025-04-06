#!/bin/bash

# Скрипт для настройки системы резервного копирования на удаленном сервере

# Загружаем конфигурацию и общие функции
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/backup_config.sh"

# Путь к директории скриптов
SCRIPTS_DIR="/home/user/iqbanana_space_disk/scripts"

# Получаем API ключ из .env файла бэкенда
BACKEND_ENV_FILE="/home/user/iqbanana_space_disk/backend/.env"
SERVER_IP=$(hostname -I | awk '{print $1}')
API_URL="http://${SERVER_IP}:6005"

# Функция для записи в лог
log() {
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1"
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1" >> "$LOG_FILE"
}

# Проверяем наличие .env файла
if [ ! -f "$BACKEND_ENV_FILE" ]; then
    log "ОШИБКА: Файл .env не найден по пути $BACKEND_ENV_FILE"
    exit 1
fi

# Извлекаем BACKUP_API_KEY из .env файла
BACKUP_API_KEY=$(grep BACKUP_API_KEY $BACKEND_ENV_FILE | cut -d'=' -f2 | tr -d '\r' | tr -d ' ' | tr -d '"' | tr -d "'")
if [ -z "$BACKUP_API_KEY" ]; then
    log "ОШИБКА: BACKUP_API_KEY не найден в файле .env"
    log "Пожалуйста, добавьте в файл .env строку BACKUP_API_KEY=ваш_ключ"
    exit 1
fi

# Проверка пути для сохранения бэкапов
if [ -z "$BACKUP_PATH" ]; then
    log "ОШИБКА: BACKUP_PATH не задан в конфигурации"
    log "Устанавливаем путь по умолчанию: /root/backups"
    BACKUP_PATH="/root/backups"
fi

log "Используется BACKUP_API_KEY из .env файла: $BACKUP_API_KEY"
log "Путь для сохранения бэкапов: $BACKUP_PATH"

# Получаем порт из .env, если есть
ENV_PORT=$(grep PORT $BACKEND_ENV_FILE | cut -d'=' -f2 | tr -d '\r')
if [ -n "$ENV_PORT" ]; then
    API_URL="http://localhost:$ENV_PORT"
fi

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

# Проверка и установка необходимых зависимостей на удаленном сервере
log "Проверка и установка необходимых зависимостей на сервере $BACKUP_SERVER"

# Создаем временный скрипт для проверки и установки зависимостей
cat > /tmp/check_deps.sh << 'EOF'
#!/bin/bash

# Определяем, какой менеджер пакетов использовать
if command -v apt-get &> /dev/null; then
    PKG_MANAGER="apt-get"
    INSTALL_CMD="apt-get update && apt-get install -y"
elif command -v yum &> /dev/null; then
    PKG_MANAGER="yum"
    INSTALL_CMD="yum -y install"
elif command -v dnf &> /dev/null; then
    PKG_MANAGER="dnf"
    INSTALL_CMD="dnf -y install"
elif command -v zypper &> /dev/null; then
    PKG_MANAGER="zypper"
    INSTALL_CMD="zypper in -y"
else
    echo "Не удалось определить менеджер пакетов. Установите пакеты вручную."
    exit 1
fi

echo "Используем менеджер пакетов: $PKG_MANAGER"

# Проверка и установка пакетов
check_and_install() {
    command_name="$1"
    package_name="$2"
    
    echo "Проверка команды $command_name (пакет $package_name)..."
    
    if ! command -v "$command_name" &> /dev/null; then
        echo "Команда $command_name не найдена. Устанавливаю пакет $package_name..."
        eval "$INSTALL_CMD $package_name"
        
        if ! command -v "$command_name" &> /dev/null; then
            echo "ОШИБКА: Не удалось установить $package_name!"
            return 1
        else
            echo "Пакет $package_name успешно установлен."
        fi
    else
        echo "Команда $command_name найдена, пакет $package_name уже установлен."
    fi
    return 0
}

# Устанавливаем необходимые пакеты
echo "Установка необходимых зависимостей..."
check_and_install "curl" "curl" || exit 1
check_and_install "tar" "tar" || exit 1
check_and_install "find" "findutils" || exit 1

# Дополнительная проверка, что все команды доступны
for cmd in curl tar find; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "КРИТИЧЕСКАЯ ОШИБКА: Команда $cmd все еще недоступна после установки!"
        exit 1
    fi
done

echo "Все необходимые зависимости установлены и доступны."
exit 0
EOF

# Копируем и выполняем скрипт проверки зависимостей на удаленном сервере
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -P "$BACKUP_SERVER_PORT" /tmp/check_deps.sh root@$BACKUP_SERVER:/tmp/check_deps.sh
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "chmod +x /tmp/check_deps.sh && /tmp/check_deps.sh"

if [ $? -ne 0 ]; then
    log "Ошибка: Не удалось установить необходимые зависимости на сервере"
    exit 1
fi

# Копируем скрипты из директории scripts на сервер
log "Копирование скриптов на сервер $BACKUP_SERVER"
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -P "$BACKUP_SERVER_PORT" "$SCRIPTS_DIR/make_backup.sh" root@$BACKUP_SERVER:/root/make_backup.sh
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -P "$BACKUP_SERVER_PORT" "$SCRIPTS_DIR/setup_backup_cron.sh" root@$BACKUP_SERVER:/root/setup_cron.sh

# Устанавливаем права на выполнение скриптов
log "Установка прав на выполнение скриптов"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "chmod +x /root/make_backup.sh /root/setup_cron.sh"

# Создаем каталог для резервного копирования на удаленном сервере
log "Создание каталога для бэкапов на сервере $BACKUP_SERVER: $BACKUP_PATH"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "mkdir -p $BACKUP_PATH"

# Удаляем старую запись crontab, если она существует
log "Удаление старых crontab-заданий для диска $SOURCE_UUID"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "crontab -l | grep -v 'make_backup.sh.*$SOURCE_UUID' | crontab -"

# Напрямую добавляем правильную задачу в crontab
CRON_EXPR="0 2 * * *"
BACKUP_CMD="/root/make_backup.sh $SOURCE_UUID $BACKUP_PATH $BACKUP_API_KEY $API_URL $BACKUP_FREQUENCY"
log "Добавление новой задачи в crontab: $CRON_EXPR $BACKUP_CMD"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "(crontab -l 2>/dev/null || echo '') | grep -v 'make_backup.sh.*$SOURCE_UUID' | { cat; echo '$CRON_EXPR $BACKUP_CMD'; } | crontab -"

# Запускаем бэкап немедленно, если указано
if [ "$1" == "now" ]; then
    log "Запуск немедленного резервного копирования..."
    # Порядок аргументов: disk_uuid, backup_path, api_key, api_url, interval
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" root@$BACKUP_SERVER "bash -c '/root/make_backup.sh \"$SOURCE_UUID\" \"$BACKUP_PATH\" \"$BACKUP_API_KEY\" \"$API_URL\" \"$BACKUP_FREQUENCY\"'"
    
    # Проверяем статус выполнения
    if [ $? -eq 0 ]; then
        log "Резервное копирование успешно выполнено"
    else
        log "Ошибка при выполнении резервного копирования"
    fi
fi

# Остальная часть скрипта без изменений
log "Настройка резервного копирования завершена."
exit 0 