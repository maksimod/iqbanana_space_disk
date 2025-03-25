#!/bin/bash
set -eo pipefail

# Устанавливаем переменные окружения для безопасности
export ANSIBLE_RETRY_FILES_ENABLED=false
export ANSIBLE_ALLOW_WORLD_READABLE_TMPFILES=true
export ANSIBLE_HOST_KEY_CHECKING=false
export ANSIBLE_TIMEOUT=30
export ANSIBLE_KEEP_REMOTE_FILES=false
export ANSIBLE_RETRY_FILES_ENABLED=false
export ANSIBLE_COMMAND_WARNINGS=false
export ANSIBLE_PIPELINING=true

# Выключаем async совсем
export ANSIBLE_ASYNC_DIR=/tmp/ansible_async
export ANSIBLE_ASYNC_POLL_INTERVAL=0
export DISABLE_ASYNC=true

# Очищаем временную директорию
rm -rf /tmp/ansible_async
mkdir -p /tmp/ansible_async
chmod 700 /tmp/ansible_async

# Запоминаем время начала
date +%s > /tmp/ansible_start_time.txt
chmod 644 /tmp/ansible_start_time.txt

echo "Запуск Ansible в линейном режиме (без асинхронности)..."
echo "Все диагностические сообщения будут сохранены в файле ansible_log.txt"

# Вызов Ansible с линейной стратегией и исключенной асинхронностью
ansible-playbook -i inventory playbook.yml --diff -vvv -e "disable_async=true" "$@" | tee ansible_log.txt

# Вывод отчета о выполнении
if [ -f /tmp/ansible_mount_report.txt ]; then
  echo -e "\n\nОТЧЕТ ВЫПОЛНЕНИЯ:"
  cat /tmp/ansible_mount_report.txt
else
  echo -e "\n\nОТЧЕТ НЕ СГЕНЕРИРОВАН!"
fi

echo -e "\nВыполнение скрипта завершено."