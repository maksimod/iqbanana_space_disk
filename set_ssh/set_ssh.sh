#!/bin/bash

# Скрипт для автоматической настройки SSH-соединения между ПК через прокси
# Автор: Claude
# Версия: 1.1

# Проверка и переход к root пользователю, если нужно
if [ "$(id -u)" -ne 0 ]; then
    echo "Этот скрипт должен быть запущен от имени root. Выполняется переход к root..."
    exec sudo "$0" "$@"
    exit 1  # Эта строка выполнится только если sudo не сработает
fi

# Жестко заданные IP-адреса серверов
CLIENT_IP="192.168.0.103"
SERVER_IP="192.168.0.107"
PROXY_IP="46.35.241.37"
PROXY_PORT="22"

# Имена пользователей по умолчанию
CLIENT_USER="root"
SERVER_USER="root"
PROXY_USER="root"

# Функции для цветного вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для логирования
log_file="/tmp/ssh_setup_$(date +%Y%m%d_%H%M%S).log"
log() {
    echo -e "${2:-$NC}$1${NC}"
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1" >> "$log_file"
}

# Функция для обработки ошибок
error_exit() {
    log "$1" "$RED"
    exit 1
}

# Баннер
echo -e "${BLUE}"
echo "======================================================="
echo "   Автоматическая настройка SSH-соединения через прокси"
echo "======================================================="
echo -e "${NC}"

# Начинаем логирование
echo "Лог настройки SSH-соединения" > "$log_file"
echo "Дата: $(date)" >> "$log_file"
echo "=======================================================" >> "$log_file"

# Определение режима работы (удаленно или по локальной сети)
echo -e "${YELLOW}"
read -p "Вы используете сервер удаленно или по локальной сети? (удаленно/локально): " CONNECTION_MODE
echo -e "${NC}"

# Установка режима и информация о настройке
USE_PROXY=true
USE_DIRECT=true

if [[ "$CONNECTION_MODE" == "удаленно" ]]; then
    log "Выбран режим удаленного подключения через прокси." "$BLUE"
    USE_DIRECT=false
elif [[ "$CONNECTION_MODE" == "локально" ]]; then
    log "Выбран режим локального подключения без прокси." "$BLUE"
    USE_PROXY=false
else
    log "Режим не распознан, используются оба варианта подключения." "$YELLOW"
fi

# Информация о настройке
log "Настройка SSH-соединения между следующими хостами:" "$BLUE"
log "Клиент: $CLIENT_USER@$CLIENT_IP" "$YELLOW"
if [ "$USE_DIRECT" = true ]; then
    log "Сервер: $SERVER_USER@$SERVER_IP" "$YELLOW"
fi
if [ "$USE_PROXY" = true ]; then
    log "Прокси: $PROXY_USER@$PROXY_IP:$PROXY_PORT" "$YELLOW"
fi
echo

# Запрашиваем пароли
if [ "$USE_PROXY" = true ]; then
    read -sp "Введите пароль для пользователя $PROXY_USER на прокси-сервере $PROXY_IP: " PROXY_PASSWORD
    echo
fi
read -sp "Введите пароль для пользователя $CLIENT_USER на клиенте $CLIENT_IP: " CLIENT_PASSWORD
echo
if [ "$USE_DIRECT" = true ]; then
    read -sp "Введите пароль для пользователя $SERVER_USER на сервере $SERVER_IP: " SERVER_PASSWORD
    echo
fi

# Подтверждаем данные
echo
log "Проверьте введенные данные:" "$YELLOW"
if [ "$USE_PROXY" = true ]; then
    log "Прокси: $PROXY_USER@$PROXY_IP:$PROXY_PORT (пароль введен)" "$YELLOW"
fi
log "Клиент: $CLIENT_USER@$CLIENT_IP (пароль введен)" "$YELLOW"
if [ "$USE_DIRECT" = true ]; then
    log "Сервер: $SERVER_USER@$SERVER_IP (пароль введен)" "$YELLOW"
fi
read -p "Продолжить? (y/n): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    error_exit "Операция отменена пользователем."
fi

# Устанавливаем необходимые пакеты
log "Проверка и установка необходимых пакетов..." "$BLUE"
if ! command -v sshpass &> /dev/null; then
    log "Установка sshpass..."
    apt-get update && apt-get install -y sshpass || error_exit "Не удалось установить sshpass"
fi

# Функция для выполнения команд через прокси
proxy_exec() {
    local target=$1
    local target_user=$2
    local target_password=$3
    local command=$4
    
    log "Выполнение команды на $target_user@$target..." "$BLUE"
    
    local output
    
    if [ "$USE_PROXY" = true ]; then
        # Выполняем команду через прокси, избегая передачи символов форматирования
        output=$(sshpass -p "$PROXY_PASSWORD" ssh -p "$PROXY_PORT" -o StrictHostKeyChecking=no "$PROXY_USER@$PROXY_IP" "sshpass -p '$target_password' ssh -o StrictHostKeyChecking=no $target_user@$target '$command'")
    else
        # Выполняем команду напрямую
        output=$(sshpass -p "$target_password" ssh -o StrictHostKeyChecking=no "$target_user@$target" "$command")
    fi
    
    result=$?
    
    if [ $result -eq 0 ]; then
        log "✓ Команда успешно выполнена на $target" "$GREEN"
    else
        log "✗ Ошибка выполнения команды на $target" "$RED"
        log "Код ошибки: $result" "$RED"
        log "Вывод: $output" "$RED"
    fi
    
    echo "$output"
    return $result
}

# Генерация ключей на клиенте
log "Генерация SSH-ключей на клиенте..." "$BLUE"
client_key_gen=$(proxy_exec "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && (rm -f ~/.ssh/id_rsa_server ~/.ssh/id_rsa_server.pub || true) && ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa_server -N \"\" -q && echo 'Ключи успешно сгенерированы'")

if ! echo "$client_key_gen" | grep -q "успешно"; then
    error_exit "Ошибка генерации ключей на клиенте"
fi

# Генерация ключей на сервере
if [ "$USE_DIRECT" = true ]; then
    log "Генерация SSH-ключей на сервере..." "$BLUE"
    server_key_gen=$(proxy_exec "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && (rm -f ~/.ssh/id_rsa_client ~/.ssh/id_rsa_client.pub || true) && ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa_client -N \"\" -q && echo 'Ключи успешно сгенерированы'")

    if ! echo "$server_key_gen" | grep -q "успешно"; then
        error_exit "Ошибка генерации ключей на сервере"
    fi
fi

# Получение публичного ключа клиента и копирование его на сервер
log "Получение публичного ключа клиента..." "$BLUE"
client_pubkey=$(proxy_exec "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "cat ~/.ssh/id_rsa_server.pub")

if [ -z "$client_pubkey" ]; then
    error_exit "Не удалось получить публичный ключ клиента"
fi

if [ "$USE_DIRECT" = true ]; then
    log "Копирование публичного ключа клиента на сервер..." "$BLUE"
    server_add_key=$(proxy_exec "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "echo '$client_pubkey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'Ключ клиента добавлен'")

    if ! echo "$server_add_key" | grep -q "добавлен"; then
        error_exit "Ошибка добавления ключа клиента на сервер"
    fi
fi

# Получение публичного ключа сервера и копирование его на клиент
if [ "$USE_DIRECT" = true ]; then
    log "Получение публичного ключа сервера..." "$BLUE"
    server_pubkey=$(proxy_exec "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "cat ~/.ssh/id_rsa_client.pub")

    if [ -z "$server_pubkey" ]; then
        error_exit "Не удалось получить публичный ключ сервера"
    fi

    log "Копирование публичного ключа сервера на клиент..." "$BLUE"
    client_add_key=$(proxy_exec "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "echo '$server_pubkey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'Ключ сервера добавлен'")

    if ! echo "$client_add_key" | grep -q "добавлен"; then
        error_exit "Ошибка добавления ключа сервера на клиент"
    fi
fi

# Создание конфигурации SSH на клиенте
if [ "$USE_DIRECT" = true ]; then
    log "Создание конфигурации SSH на клиенте..." "$BLUE"
    client_ssh_config=$(proxy_exec "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "cat > ~/.ssh/config << EOF
Host server
    HostName $SERVER_IP
    User $SERVER_USER
    IdentityFile ~/.ssh/id_rsa_server
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config && echo 'Конфигурация SSH создана'")

    if ! echo "$client_ssh_config" | grep -q "создана"; then
        error_exit "Ошибка создания конфигурации SSH на клиенте"
    fi
fi

# Создание конфигурации SSH на сервере
if [ "$USE_DIRECT" = true ]; then
    log "Создание конфигурации SSH на сервере..." "$BLUE"
    server_ssh_config=$(proxy_exec "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "cat > ~/.ssh/config << EOF
Host client
    HostName $CLIENT_IP
    User $CLIENT_USER
    IdentityFile ~/.ssh/id_rsa_client
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config && echo 'Конфигурация SSH создана'")

    if ! echo "$server_ssh_config" | grep -q "создана"; then
        error_exit "Ошибка создания конфигурации SSH на сервере"
    fi
fi

# Проверка соединения от клиента к серверу
if [ "$USE_DIRECT" = true ]; then
    log "Проверка SSH-соединения от клиента к серверу..." "$BLUE"
    client_to_server=$(proxy_exec "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 server 'echo Соединение_успешно; hostname; whoami'")

    if echo "$client_to_server" | grep -q "Соединение_успешно"; then
        log "✓ Клиент успешно соединяется с сервером без пароля" "$GREEN"
        log "Вывод: $client_to_server" "$GREEN"
    else
        log "✗ Ошибка соединения от клиента к серверу" "$RED"
        log "Вывод: $client_to_server" "$RED"
    fi

    # Проверка соединения от сервера к клиенту
    log "Проверка SSH-соединения от сервера к клиенту..." "$BLUE"
    server_to_client=$(proxy_exec "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 client 'echo Соединение_успешно; hostname; whoami'")

    if echo "$server_to_client" | grep -q "Соединение_успешно"; then
        log "✓ Сервер успешно соединяется с клиентом без пароля" "$GREEN"
        log "Вывод: $server_to_client" "$GREEN"
    else
        log "✗ Ошибка соединения от сервера к клиенту" "$RED"
        log "Вывод: $server_to_client" "$RED"
    fi
fi

# Проверка сохранения прокси соединения
if [ "$USE_PROXY" = true ]; then
    log "Проверка соединения через прокси..." "$BLUE"
    proxy_connection=$(sshpass -p "$PROXY_PASSWORD" ssh -p "$PROXY_PORT" -o StrictHostKeyChecking=no "$PROXY_USER@$PROXY_IP" "echo Прокси_соединение_работает")

    if echo "$proxy_connection" | grep -q "Прокси_соединение_работает"; then
        log "✓ Соединение через прокси работает" "$GREEN"
    else
        log "✗ Проблема с соединением через прокси" "$RED"
    fi
fi

# Итоговый отчет
echo
log "======= РЕЗУЛЬТАТЫ НАСТРОЙКИ =======" "$BLUE"
log "Лог сохранен в файле: $log_file" "$GREEN"

if [ "$USE_DIRECT" = true ]; then
    if echo "$client_to_server" | grep -q "Соединение_успешно" && echo "$server_to_client" | grep -q "Соединение_успешно"; then
        log "✓ SSH-соединение между клиентом и сервером настроено успешно!" "$GREEN"
        log "  - Клиент ($CLIENT_IP) может подключаться к серверу без пароля" "$GREEN"
        log "  - Сервер ($SERVER_IP) может подключаться к клиенту без пароля" "$GREEN"
    else
        log "⚠ Настройка SSH-соединения выполнена с ошибками." "$YELLOW"
        [ ! "$(echo "$client_to_server" | grep -q "Соединение_успешно")" ] && log "  - Проблема с подключением от клиента к серверу" "$RED"
        [ ! "$(echo "$server_to_client" | grep -q "Соединение_успешно")" ] && log "  - Проблема с подключением от сервера к клиенту" "$RED"
    fi
fi

if [ "$USE_PROXY" = true ]; then
    if echo "$proxy_connection" | grep -q "Прокси_соединение_работает"; then
        log "✓ Соединение через прокси сохранено" "$GREEN"
    else
        log "⚠ Проблема с соединением через прокси" "$RED"
    fi
fi

echo
log "ИНСТРУКЦИИ ПО ИСПОЛЬЗОВАНИЮ:" "$BLUE"
if [ "$USE_DIRECT" = true ]; then
    log "На клиенте используйте: ssh server" "$YELLOW"
    log "На сервере используйте: ssh client" "$YELLOW"
fi
if [ "$USE_PROXY" = true ]; then
    log "Через прокси: sshpass -p 'пароль' ssh -p $PROXY_PORT $PROXY_USER@$PROXY_IP" "$YELLOW"
fi

echo
log "Для проверки полного лога выполните: cat $log_file" "$BLUE"