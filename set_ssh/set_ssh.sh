#!/bin/bash

# Скрипт для автоматической настройки SSH-соединения между ПК
# Автор: Claude
# Версия: 2.0

# Проверка и переход к root пользователю, если нужно
if [ "$(id -u)" -ne 0 ]; then
    echo "Этот скрипт должен быть запущен от имени root. Выполняется переход к root..."
    exec sudo "$0" "$@"
    exit 1  # Эта строка выполнится только если sudo не сработает
fi

# Жестко заданные IP-адреса серверов
CLIENT_IP="192.168.0.103"
SERVER_IP="192.168.0.106"

# Имена пользователей по умолчанию
CLIENT_USER="root"
SERVER_USER="root"

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
echo "   Автоматическая настройка SSH-соединения с ключами"
echo "======================================================="
echo -e "${NC}"

# Начинаем логирование
echo "Лог настройки SSH-соединения" > "$log_file"
echo "Дата: $(date)" >> "$log_file"
echo "=======================================================" >> "$log_file"

# Информация о настройке
log "Настройка SSH-соединения с использованием ключей между:" "$BLUE"
log "Клиент: $CLIENT_USER@$CLIENT_IP" "$YELLOW"
log "Сервер: $SERVER_USER@$SERVER_IP" "$YELLOW"
echo

# Запрашиваем пароли
read -sp "Введите пароль для пользователя $CLIENT_USER на клиенте $CLIENT_IP: " CLIENT_PASSWORD
echo
read -sp "Введите пароль для пользователя $SERVER_USER на сервере $SERVER_IP: " SERVER_PASSWORD
echo

# Подтверждаем данные
echo
log "Проверьте введенные данные:" "$YELLOW"
log "Клиент: $CLIENT_USER@$CLIENT_IP (пароль введен)" "$YELLOW"
log "Сервер: $SERVER_USER@$SERVER_IP (пароль введен)" "$YELLOW"
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

# Функция для выполнения команд
exec_cmd() {
    local target=$1
    local target_user=$2
    local target_password=$3
    local command=$4
    
    log "Выполнение команды на $target_user@$target..." "$BLUE"
    
    local output
    
    # Выполняем команду напрямую
    output=$(sshpass -p "$target_password" ssh -o StrictHostKeyChecking=no "$target_user@$target" "$command")
    
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
client_key_gen=$(exec_cmd "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && (rm -f ~/.ssh/id_rsa_server ~/.ssh/id_rsa_server.pub || true) && ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa_server -N \"\" -q && echo 'Ключи успешно сгенерированы'")

if ! echo "$client_key_gen" | grep -q "успешно"; then
    error_exit "Ошибка генерации ключей на клиенте"
fi

# Генерация ключей на сервере
log "Генерация SSH-ключей на сервере..." "$BLUE"
server_key_gen=$(exec_cmd "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && (rm -f ~/.ssh/id_rsa_client ~/.ssh/id_rsa_client.pub || true) && ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa_client -N \"\" -q && echo 'Ключи успешно сгенерированы'")

if ! echo "$server_key_gen" | grep -q "успешно"; then
    error_exit "Ошибка генерации ключей на сервере"
fi

# Получение публичного ключа клиента и копирование его на сервер
log "Получение публичного ключа клиента..." "$BLUE"
client_pubkey=$(exec_cmd "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "cat ~/.ssh/id_rsa_server.pub")

if [ -z "$client_pubkey" ]; then
    error_exit "Не удалось получить публичный ключ клиента"
fi

log "Копирование публичного ключа клиента на сервер..." "$BLUE"
server_add_key=$(exec_cmd "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "echo '$client_pubkey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'Ключ клиента добавлен'")

if ! echo "$server_add_key" | grep -q "добавлен"; then
    error_exit "Ошибка добавления ключа клиента на сервер"
fi

# Получение публичного ключа сервера и копирование его на клиент
log "Получение публичного ключа сервера..." "$BLUE"
server_pubkey=$(exec_cmd "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "cat ~/.ssh/id_rsa_client.pub")

if [ -z "$server_pubkey" ]; then
    error_exit "Не удалось получить публичный ключ сервера"
fi

log "Копирование публичного ключа сервера на клиент..." "$BLUE"
client_add_key=$(exec_cmd "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "echo '$server_pubkey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'Ключ сервера добавлен'")

if ! echo "$client_add_key" | grep -q "добавлен"; then
    error_exit "Ошибка добавления ключа сервера на клиент"
fi

# Создание конфигурации SSH на клиенте
log "Создание конфигурации SSH на клиенте..." "$BLUE"
client_ssh_config=$(exec_cmd "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "cat > ~/.ssh/config << EOF
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

# Создание конфигурации SSH на сервере
log "Создание конфигурации SSH на сервере..." "$BLUE"
server_ssh_config=$(exec_cmd "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "cat > ~/.ssh/config << EOF
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

# Проверка соединения от клиента к серверу
log "Проверка SSH-соединения от клиента к серверу..." "$BLUE"
client_to_server=$(exec_cmd "$CLIENT_IP" "$CLIENT_USER" "$CLIENT_PASSWORD" "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 server 'echo Соединение_успешно; hostname; whoami'")

if echo "$client_to_server" | grep -q "Соединение_успешно"; then
    log "✓ Клиент успешно соединяется с сервером без пароля" "$GREEN"
    log "Вывод: $client_to_server" "$GREEN"
else
    log "✗ Ошибка соединения от клиента к серверу" "$RED"
    log "Вывод: $client_to_server" "$RED"
fi

# Проверка соединения от сервера к клиенту
log "Проверка SSH-соединения от сервера к клиенту..." "$BLUE"
server_to_client=$(exec_cmd "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 client 'echo Соединение_успешно; hostname; whoami'")

if echo "$server_to_client" | grep -q "Соединение_успешно"; then
    log "✓ Сервер успешно соединяется с клиентом без пароля" "$GREEN"
    log "Вывод: $server_to_client" "$GREEN"
else
    log "✗ Ошибка соединения от сервера к клиенту" "$RED"
    log "Вывод: $server_to_client" "$RED"
fi

# Итоговый отчет
echo
log "======= РЕЗУЛЬТАТЫ НАСТРОЙКИ =======" "$BLUE"
log "Лог сохранен в файле: $log_file" "$GREEN"

if echo "$client_to_server" | grep -q "Соединение_успешно" && echo "$server_to_client" | grep -q "Соединение_успешно"; then
    log "✓ SSH-соединение между клиентом и сервером настроено успешно!" "$GREEN"
    log "  - Клиент ($CLIENT_IP) может подключаться к серверу без пароля" "$GREEN"
    log "  - Сервер ($SERVER_IP) может подключаться к клиенту без пароля" "$GREEN"
else
    log "⚠ Настройка SSH-соединения выполнена с ошибками." "$YELLOW"
    [ ! "$(echo "$client_to_server" | grep -q "Соединение_успешно")" ] && log "  - Проблема с подключением от клиента к серверу" "$RED"
    [ ! "$(echo "$server_to_client" | grep -q "Соединение_успешно")" ] && log "  - Проблема с подключением от сервера к клиенту" "$RED"
fi

echo
log "ИНСТРУКЦИИ ПО ИСПОЛЬЗОВАНИЮ:" "$BLUE"
log "На клиенте используйте: ssh server" "$YELLOW"
log "На сервере используйте: ssh client" "$YELLOW"

echo
log "Для проверки полного лога выполните: cat $log_file" "$BLUE"