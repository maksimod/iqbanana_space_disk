#!/bin/bash

# Скрипт для запуска оптимизированного Ansible playbook

# Параметры по умолчанию
STRATEGY="free"
FORKS=20
PARALLEL=true

# Обработка аргументов командной строки
while [[ $# -gt 0 ]]; do
    case $1 in
        --strategy=*)
            STRATEGY="${1#*=}"
            shift
            ;;
        --forks=*)
            FORKS="${1#*=}"
            shift
            ;;
        --no-parallel)
            PARALLEL=false
            shift
            ;;
        --help)
            echo "Использование: $0 [опции] [дополнительные аргументы для ansible-playbook]"
            echo "Опции:"
            echo "  --strategy=STRATEGY  Стратегия выполнения (free, linear, debug). По умолчанию: free"
            echo "  --forks=N            Количество параллельных процессов. По умолчанию: 20"
            echo "  --no-parallel        Отключить параллельное выполнение задач"
            echo "  --help               Показать это сообщение"
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

# Очистка кэша фактов
echo "Очистка кэша фактов..."
rm -rf /tmp/ansible_fact_cache
mkdir -p /tmp/ansible_fact_cache

# Настройка переменных окружения для дополнительной оптимизации
export ANSIBLE_PIPELINING=True
export ANSIBLE_SSH_PIPELINING=True
export ANSIBLE_CACHE_PLUGIN=jsonfile
export ANSIBLE_CACHE_PLUGIN_CONNECTION=/tmp/ansible_fact_cache
export ANSIBLE_CACHE_PLUGIN_TIMEOUT=86400
export ANSIBLE_GATHERING=smart
export ANSIBLE_STRATEGY=$STRATEGY
export ANSIBLE_FORKS=$FORKS
export ANSIBLE_CALLBACK_WHITELIST=profile_tasks,timer
export ANSIBLE_STDOUT_CALLBACK=yaml

# Дополнительные оптимизации
if [ "$PARALLEL" = true ]; then
    export ANSIBLE_GATHERING_TIMEOUT=30
    export ANSIBLE_TIMEOUT=60
    export ANSIBLE_POLL_INTERVAL=1
    export ANSIBLE_DISPLAY_SKIPPED_HOSTS=false
    export ANSIBLE_SSH_RETRIES=5
    export ANSIBLE_DISPLAY_OK_HOSTS=false
fi

# Проверка SSH-соединения перед запуском для ускорения
echo "Проверка SSH-соединения с хостами..."
for host in $(awk '/ansible_user/ {print $1}' inventory); do
    nc -z -w 2 $host 22 &> /dev/null
    if [ $? -eq 0 ]; then
        echo "SSH доступен для $host"
    else
        echo "ПРЕДУПРЕЖДЕНИЕ: SSH недоступен для $host, проверьте настройки подключения"
    fi
done

# Включаем подсчет времени
START_TIME=$(date +%s)

# Запуск playbook с оптимальными параметрами
echo "Запуск оптимизированного playbook со стратегией $STRATEGY и $FORKS форками..."
ansible-playbook -i inventory playbook.yml --diff "$@"

# Подсчет общего времени выполнения
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

# Вывод времени работы скрипта
echo "Скрипт выполнен за ${MINUTES}:${SECONDS} (${MINUTES} минут ${SECONDS} секунд)!"
