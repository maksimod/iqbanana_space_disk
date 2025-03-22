#!/bin/bash

# Скрипт для запуска ansible с паролем
# Временно модифицирует файл hosts для добавления пароля

echo "================ ANSIBLE ЗАПУСК ================="
echo "Запуск playbook с вводом пароля для сервера agger (192.168.0.104)"
echo "================================================="

# Запрос пароля
read -s -p "Введите пароль для пользователя agger на сервере agger (192.168.0.104): " PASSWORD
echo ""

# Создание резервной копии hosts
TEMP_HOSTS=$(mktemp)
cp ~/iqbanana-disk/ansible-debian-setup/hosts "$TEMP_HOSTS"

# Модификация hosts для включения пароля
echo "Обновление файла hosts с паролем..."
sed -i "s/ansible_user=agger/ansible_user=agger ansible_ssh_pass=$PASSWORD/" ~/iqbanana-disk/ansible-debian-setup/hosts

# Запуск ansible
echo "Запуск ansible-playbook..."
cd ~/iqbanana-disk/ansible-debian-setup/
ansible-playbook -i hosts playbook.yml

# Восстановление hosts
echo "Восстановление оригинального файла hosts..."
cp "$TEMP_HOSTS" ~/iqbanana-disk/ansible-debian-setup/hosts
rm -f "$TEMP_HOSTS"

echo "Процесс завершен."
exit 0 