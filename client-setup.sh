#!/bin/bash

# Файл для отслеживания обновлений
UPDATE_MARKER="/tmp/system_update_marker"

# Функция для проверки последнего обновления
check_last_update() {
    if [ ! -f "$UPDATE_MARKER" ]; then
        sudo apt update
        sudo apt upgrade -y
        touch "$UPDATE_MARKER"
    else
        echo "Система уже была недавно обновлена"
    fi
}

# Отключение спящего режима
disable_sleep() {
    sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
}

# Установка Git
install_git() {
    if ! command -v git &> /dev/null; then
        sudo apt install git -y
        git --version
    else
        echo "Git уже установлен. Версия: $(git --version)"
    fi
}

# Установка Node.js и npm
install_nodejs() {
    if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
        sudo apt install nodejs npm -y
    else
        echo "Node.js и npm уже установлены"
        node --version
        npm --version
    fi
}

# Установка Ansible
install_ansible() {
    if ! command -v ansible &> /dev/null; then
        # Добавляем репозиторий Ansible
        sudo apt update
        sudo apt install software-properties-common -y
        sudo add-apt-repository --yes --update ppa:ansible/ansible
        
        # Устанавливаем Ansible
        sudo apt install ansible -y
        
        # Проверяем версию
        ansible --version
    else
        echo "Ansible уже установлен. Версия: $(ansible --version | head -n 1)"
    fi
}

# Настройка базовой конфигурации Ansible
configure_ansible() {
    # Создаем базовую структуру каталогов
    mkdir -p ~/ansible/inventory
    mkdir -p ~/ansible/playbooks
    mkdir -p ~/ansible/roles

    # Создаем базовый инвентарный файл
    cat << EOF > ~/ansible/inventory/hosts
[servers]
localhost ansible_connection=local
# Добавьте сюда другие хосты по мере необходимости
EOF

    # Создаем базовый конфигурационный файл ansible.cfg
    cat << EOF > ~/ansible/ansible.cfg
[defaults]
inventory = ~/ansible/inventory/hosts
remote_user = $USER
ask_pass = false
host_key_checking = false
EOF

    echo "Базовая конфигурация Ansible создана в ~/ansible/"
}

# Справка по использованию скрипта
show_help() {
    echo "Использование: $0 [--update] [--help]"
    echo "  --update   Обновить систему перед установкой компонентов"
    echo "  --help     Показать эту справку"
}

# Разбор аргументов командной строки
main() {
    # Разбор параметров
    while [[ "$#" -gt 0 ]]; do
        case $1 in
            --update) 
                check_last_update
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                echo "Неизвестный параметр: $1"
                show_help
                exit 1
                ;;
        esac
        shift
    done

    # Основные действия
    disable_sleep
    install_git
    install_nodejs
    install_ansible
    configure_ansible
}

# Запуск основной функции
main "$@"
