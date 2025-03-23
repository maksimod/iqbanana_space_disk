#!/bin/bash
# auto-configure.sh - Универсальный скрипт для автоматической настройки с Ansible
# 
# Использование:
#   ./auto-configure.sh [опция]
#
# Опции:
#   setup-nfs     - Настройка NFS-сервера и клиента
#   setup-backup  - Настройка системы резервного копирования
#   setup-all     - Полная настройка системы (NFS + резервное копирование)
#   help          - Показать справку

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция вывода сообщений
log() {
    echo -e "$1"
}

# Проверка наличия Ansible
check_ansible() {
    log "${BLUE}=== Проверка наличия Ansible ===${NC}"
    if ! command -v ansible &> /dev/null; then
        log "${YELLOW}Ansible не установлен. Установка...${NC}"
        sudo apt update
        sudo apt install -y ansible
        
        if ! command -v ansible &> /dev/null; then
            log "${RED}Не удалось установить Ansible. Проверьте подключение к интернету и наличие прав.${NC}"
            return 1
        fi
    fi
    
    log "${GREEN}Ansible установлен: $(ansible --version | head -n 1)${NC}"
    return 0
}

# Настройка hosts для Ansible
setup_hosts() {
    log "${BLUE}=== Настройка hosts для Ansible ===${NC}"
    
    # Проверка наличия файла hosts
    if [ ! -f "hosts" ]; then
        log "${RED}Файл hosts не найден. Создание...${NC}"
        cat > hosts << EOF
[agger]
192.168.0.104 ansible_user=agger

[apper]
localhost ansible_connection=local

[all:vars]
ansible_python_interpreter=/usr/bin/python3
EOF
    fi
    
    log "${GREEN}Файл hosts настроен${NC}"
    return 0
}

# Настройка конфигурации Ansible
setup_ansible_config() {
    log "${BLUE}=== Настройка конфигурации Ansible ===${NC}"
    
    # Проверка наличия файла ansible.cfg
    if [ ! -f "ansible.cfg" ]; then
        log "${YELLOW}Файл ansible.cfg не найден. Создание...${NC}"
        cat > ansible.cfg << EOF
[defaults]
inventory = hosts
host_key_checking = False
retry_files_enabled = True
retry_files_save_path = ./
roles_path = ./roles
log_path = ./ansible.log
callback_whitelist = profile_tasks, timer
timeout = 30
deprecation_warnings = False

[ssh_connection]
pipelining = True
control_path = /tmp/ansible-ssh-%%h-%%p-%%r
ssh_args = -o ControlMaster=auto -o ControlPersist=60s
EOF
    fi
    
    log "${GREEN}Файл ansible.cfg настроен${NC}"
    return 0
}

# Настройка NFS
setup_nfs() {
    log "${BLUE}=== Настройка NFS с использованием Ansible ===${NC}"
    
    # Проверка наличия плейбука для NFS
    if [ ! -f "playbook-nfs.yml" ]; then
        log "${YELLOW}Создание плейбука для NFS...${NC}"
        cat > playbook-nfs.yml << EOF
---
- name: Настройка NFS сервера
  hosts: agger
  become: true
  roles:
    - common
    - nfs

- name: Настройка клиента NFS
  hosts: apper
  become: true
  roles:
    - common
    - sync
EOF
    fi
    
    # Запуск плейбука
    log "${YELLOW}Запуск плейбука для настройки NFS...${NC}"
    ansible-playbook -i hosts playbook-nfs.yml
    
    if [ $? -eq 0 ]; then
        log "${GREEN}Настройка NFS завершена успешно${NC}"
    else
        log "${RED}Ошибка при настройке NFS${NC}"
        return 1
    fi
    
    # Больше не запускаем скрипты отдельно, так как они должны вызываться из Ansible
    log "${GREEN}NFS настроен через Ansible. Все диски должны быть уже смонтированы.${NC}"
    
    return 0
}

# Настройка системы резервного копирования
setup_backup() {
    log "${BLUE}=== Настройка системы резервного копирования с использованием Ansible ===${NC}"
    
    # Проверка наличия плейбука для резервного копирования
    if [ ! -f "playbook-backup.yml" ]; then
        log "${YELLOW}Создание плейбука для резервного копирования...${NC}"
        cat > playbook-backup.yml << EOF
---
- name: Настройка системы резервного копирования
  hosts: apper
  become: true
  roles:
    - backup
EOF
    fi
    
    # Запуск плейбука
    log "${YELLOW}Запуск плейбука для настройки резервного копирования...${NC}"
    ansible-playbook -i hosts playbook-backup.yml
    
    if [ $? -eq 0 ]; then
        log "${GREEN}Настройка системы резервного копирования завершена успешно${NC}"
        
        # Создание первого бэкапа
        log "${YELLOW}Создание первого полного бэкапа...${NC}"
        sudo ./backup-manager.sh create --full
        
        log "${GREEN}Первый полный бэкап создан${NC}"
    else
        log "${RED}Ошибка при настройке системы резервного копирования${NC}"
        return 1
    fi
    
    return 0
}

# Полная настройка системы
setup_all() {
    log "${BLUE}=== Полная настройка системы с использованием Ansible ===${NC}"
    
    setup_nfs || log "${RED}Ошибка при настройке NFS${NC}"
    setup_backup || log "${RED}Ошибка при настройке системы резервного копирования${NC}"
    
    log "${GREEN}Полная настройка системы завершена${NC}"
    return 0
}

# Вывод справки
show_help() {
    log "${BLUE}=== Справка по скрипту auto-configure.sh ===${NC}"
    log "Использование:"
    log "  ./auto-configure.sh [опция]"
    log ""
    log "Опции:"
    log "  setup-nfs     - Настройка NFS-сервера и клиента"
    log "  setup-backup  - Настройка системы резервного копирования"
    log "  setup-all     - Полная настройка системы (NFS + резервное копирование)"
    log "  help          - Показать эту справку"
    log ""
    log "Примеры:"
    log "  ./auto-configure.sh setup-nfs     # Настройка NFS"
    log "  ./auto-configure.sh setup-all     # Полная настройка системы"
    log ""
    log "Примечание: Скрипт настроен для работы с Debian-системами,"
    log "все монтирование NFS дисков происходит автоматически"
    log "с автоматическим определением доступных дисков."
    log ""
    return 0
}

# Главная функция
main() {
    local action="$1"
    
    # Проверка наличия Ansible
    check_ansible || exit 1
    
    # Настройка конфигурации
    setup_hosts
    setup_ansible_config
    
    case "$action" in
        setup-nfs)
            setup_nfs
            ;;
        setup-backup)
            setup_backup
            ;;
        setup-all)
            setup_all
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log "${RED}Неизвестная опция: $action${NC}"
            show_help
            exit 1
            ;;
    esac
    
    log "${BLUE}=== Операция завершена! ===${NC}"
    return 0
}

# Запуск скрипта с переданным аргументом
if [ $# -eq 0 ]; then
    log "${YELLOW}Не указана опция. Показываю справку...${NC}"
    show_help
    exit 0
fi

main "$1"
exit $? 