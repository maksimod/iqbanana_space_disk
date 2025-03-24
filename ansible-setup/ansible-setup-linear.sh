#!/bin/bash

# Скрипт для запуска Ansible playbook с линейной стратегией (более стабильной)
# Используйте если возникают проблемы со стратегией free

# Очистка кэша фактов
echo "Очистка кэша фактов..."
rm -rf /tmp/ansible_fact_cache
mkdir -p /tmp/ansible_fact_cache

# Настройка переменных окружения для оптимизации
export ANSIBLE_PIPELINING=True
export ANSIBLE_SSH_PIPELINING=True
export ANSIBLE_CACHE_PLUGIN=jsonfile
export ANSIBLE_CACHE_PLUGIN_CONNECTION=/tmp/ansible_fact_cache
export ANSIBLE_CACHE_PLUGIN_TIMEOUT=86400
export ANSIBLE_GATHERING=smart
export ANSIBLE_STRATEGY=linear
export ANSIBLE_FORKS=20
export ANSIBLE_TIMEOUT=60
export ANSIBLE_CALLBACK_WHITELIST=profile_tasks,timer
export ANSIBLE_STDOUT_CALLBACK=yaml
export ANSIBLE_SSH_RETRIES=5

# Проверка SSH-соединения перед запуском
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

# Запуск playbook с линейной стратегией
echo "Запуск playbook с линейной стратегией..."
ansible-playbook -i inventory playbook.yml --diff "$@"

# Подсчет общего времени выполнения
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

# Вывод времени работы скрипта
echo "Скрипт выполнен за ${MINUTES}:${SECONDS} (${MINUTES} минут ${SECONDS} секунд)!" 