#!/bin/bash

# Скрипт для настройки SSH-ключей между серверами apper и agger
# Устраняет необходимость ввода пароля при запуске ansible

echo "====================== SSH SETUP ======================"
echo "Настройка SSH-ключей для доступа с apper (192.168.0.100) на agger (192.168.0.104)"
echo "======================================================"

# Проверка существования SSH-ключей
if [ ! -f ~/.ssh/id_rsa ]; then
    echo "SSH-ключ не найден, создаю новый..."
    ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""
else
    echo "SSH-ключ уже существует."
fi

# Запрос пароля
read -s -p "Введите пароль для пользователя agger на сервере agger (192.168.0.104): " PASSWORD
echo ""

# Создание временного файла с паролем для sshpass
TEMP_FILE=$(mktemp)
echo "$PASSWORD" > "$TEMP_FILE"
chmod 600 "$TEMP_FILE"

# Копирование ключа
echo "Копирование SSH-ключа на сервер agger..."
if sshpass -f "$TEMP_FILE" ssh-copy-id -o StrictHostKeyChecking=no agger@192.168.0.104; then
    echo "SSH-ключ успешно скопирован!"
    
    # Тестирование подключения
    echo "Тестирование SSH-подключения..."
    if ssh -o BatchMode=yes -o ConnectTimeout=5 agger@192.168.0.104 echo "SSH connection successful"; then
        echo "SSH-подключение успешно установлено!"
    else
        echo "ПРЕДУПРЕЖДЕНИЕ: Не удалось протестировать SSH-подключение!"
        echo "Проверьте настройки SSH на agger и убедитесь, что ключи добавлены правильно."
    fi

    # Обновление hosts файла для Ansible
    if grep -q "ansible_ssh_pass" ~/iqbanana-disk/ansible-debian-setup/hosts; then
        echo "Обновление файла hosts для использования SSH-ключей вместо пароля..."
        sed -i 's/ansible_ssh_pass=[^ ]* //g' ~/iqbanana-disk/ansible-debian-setup/hosts
        echo "Файл hosts обновлен."
    fi
    
    echo ""
    echo "Теперь вы можете запустить ansible-playbook без ввода пароля:"
    echo "ansible-playbook -i hosts playbook.yml"
else
    echo "ОШИБКА: Не удалось скопировать SSH-ключ."
    echo "Возможные причины:"
    echo "1. Неверный пароль"
    echo "2. Сервер agger недоступен"
    echo "3. SSH-сервис на agger не настроен для приема ключей"
    echo ""
    echo "Проверка базового подключения к серверу:"
    echo "Попытка ping..."
    ping -c 3 192.168.0.104 || echo "Сервер не отвечает на ping"
    
    echo ""
    echo "Пробуем подключиться напрямую с запросом пароля:"
    echo "ssh agger@192.168.0.104"
fi

# Удаление временного файла
rm -f "$TEMP_FILE"

exit 0 