#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Настройка SSH доступа между серверами ===${NC}"

# Проверка и исправление прав доступа к .ssh
echo -e "${YELLOW}Проверка и исправление прав доступа к каталогу SSH...${NC}"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/known_hosts
chmod 644 ~/.ssh/known_hosts
chmod 600 ~/.ssh/authorized_keys 2>/dev/null || true

# Проверка наличия необходимых утилит
sudo apt update
sudo apt install -y sshpass openssh-client

# Установка переменных
AGGER_IP="192.168.0.104"
AGGER_USER="agger"
AGGER_PASS="2864"
AGGER_ROOT_PASS="rootpassword"

APPER_IP="192.168.0.100"
APPER_USER="apper" 
APPER_PASS="2864"

# Генерация SSH ключа на локальной машине, если он отсутствует
if [ ! -f ~/.ssh/id_rsa ]; then
    echo -e "${YELLOW}Генерация SSH ключа...${NC}"
    ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""
fi

# Копирование SSH ключа на сервер agger
echo -e "${YELLOW}Копирование SSH ключа на сервер agger...${NC}"
sshpass -p "$AGGER_PASS" ssh-copy-id -o StrictHostKeyChecking=no $AGGER_USER@$AGGER_IP

if [ $? -eq 0 ]; then
    echo -e "${GREEN}SSH ключ успешно скопирован на agger${NC}"
else
    echo -e "${RED}Ошибка при копировании SSH ключа на agger${NC}"
    exit 1
fi

# Копирование SSH ключа на сервер apper
echo -e "${YELLOW}Копирование SSH ключа на сервер apper...${NC}"
sshpass -p "$APPER_PASS" ssh-copy-id -o StrictHostKeyChecking=no $APPER_USER@$APPER_IP

if [ $? -eq 0 ]; then
    echo -e "${GREEN}SSH ключ успешно скопирован на apper${NC}"
else
    echo -e "${RED}Ошибка при копировании SSH ключа на apper${NC}"
    exit 1
fi

# Установка sshpass на сервере agger
echo -e "${YELLOW}Установка sshpass на сервере agger...${NC}"
ssh -o StrictHostKeyChecking=no $AGGER_USER@$AGGER_IP "sudo apt update && sudo apt install -y sshpass"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}sshpass успешно установлен на agger${NC}"
else
    echo -e "${RED}Ошибка при установке sshpass на agger${NC}"
    exit 1
fi

# Создание SSH ключа на сервере agger (если он уже не существует)
echo -e "${YELLOW}Создание SSH ключа на сервере agger...${NC}"
ssh -o StrictHostKeyChecking=no $AGGER_USER@$AGGER_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts && if [ ! -f ~/.ssh/id_rsa ]; then ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ''; fi"

# Копирование SSH ключа с agger на apper
echo -e "${YELLOW}Копирование SSH ключа с agger на apper...${NC}"
ssh -o StrictHostKeyChecking=no $AGGER_USER@$AGGER_IP "sshpass -p '$APPER_PASS' ssh-copy-id -o StrictHostKeyChecking=no $APPER_USER@$APPER_IP"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}SSH ключ с agger успешно скопирован на apper${NC}"
else
    echo -e "${RED}Ошибка при копировании SSH ключа с agger на apper${NC}"
    exit 1
fi

# Копирование конфигурации SSH для отключения строгой проверки ключей
echo -e "${YELLOW}Настройка конфигурации SSH...${NC}"
mkdir -p ~/.ssh
cat > ~/.ssh/config << EOF
Host *
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
EOF
chmod 600 ~/.ssh/config

# То же самое на сервере agger
ssh -o StrictHostKeyChecking=no $AGGER_USER@$AGGER_IP "mkdir -p ~/.ssh && cat > ~/.ssh/config << EOF
Host *
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
EOF
chmod 600 ~/.ssh/config"

# Проверка доступа
echo -e "${YELLOW}Проверка SSH доступа между серверами...${NC}"
echo -e "${YELLOW}Проверка доступа к agger...${NC}"
ssh -o StrictHostKeyChecking=no $AGGER_USER@$AGGER_IP "echo 'Соединение с agger установлено'"

echo -e "${YELLOW}Проверка доступа к apper...${NC}"
ssh -o StrictHostKeyChecking=no $APPER_USER@$APPER_IP "echo 'Соединение с apper установлено'"

echo -e "${YELLOW}Проверка доступа с agger на apper...${NC}"
ssh -o StrictHostKeyChecking=no $AGGER_USER@$AGGER_IP "ssh -o StrictHostKeyChecking=no $APPER_USER@$APPER_IP 'echo \"Соединение с apper с сервера agger установлено\"'"

echo -e "${GREEN}Настройка SSH доступа между серверами завершена успешно!${NC}"
echo -e "${YELLOW}Теперь можно запустить основной плейбук Ansible:${NC}"
echo -e "${GREEN}./auto-setup.sh${NC}"

chmod +x auto-setup.sh 