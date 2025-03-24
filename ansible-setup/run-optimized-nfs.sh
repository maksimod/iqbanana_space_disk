 #!/bin/bash

# Единый скрипт для запуска всего процесса монтирования NFS с оптимизацией
# Запускается один раз только на клиенте

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== ЗАПУСК ОПТИМИЗИРОВАННОГО СКРИПТА МОНТИРОВАНИЯ NFS ===${NC}"
echo "Данный скрипт автоматически выполнит все необходимые операции"

# Проверка, запущен ли скрипт с правами root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Ошибка: Скрипт должен быть запущен с правами root${NC}"
  echo "Пожалуйста, используйте: sudo $0"
  exit 1
fi

# Локальная оптимизация клиента
echo -e "\n${GREEN}[1/5] Применение локальных оптимизаций системы...${NC}"

# Для ускорения монтирования дисков
echo "Оптимизация кэша файловой системы..."
echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || echo -e "${YELLOW}Предупреждение: Не удалось очистить кэш${NC}"
echo 1024 > /proc/sys/vm/nr_hugepages 2>/dev/null || echo -e "${YELLOW}Предупреждение: Не удалось установить hugepages${NC}"

# Увеличиваем лимиты для файловой системы
echo "Оптимизация параметров файловой системы..."
sysctl -w fs.file-max=500000 >/dev/null 2>&1
sysctl -w vm.dirty_ratio=80 >/dev/null 2>&1
sysctl -w vm.dirty_background_ratio=5 >/dev/null 2>&1
sysctl -w vm.dirty_expire_centisecs=12000 >/dev/null 2>&1

# Оптимизация монтирования NFS
echo "Оптимизация параметров NFS..."
sysctl -w sunrpc.tcp_slot_table_entries=128 >/dev/null 2>&1 || echo -e "${YELLOW}Предупреждение: Не удалось установить tcp_slot_table_entries${NC}"
echo Y > /sys/module/sunrpc/parameters/tcp_slot_table_entries 2>/dev/null || echo -e "${YELLOW}Предупреждение: Не удалось включить tcp_slot_table_entries${NC}"
mkdir -p /etc/modprobe.d/
echo "options sunrpc tcp_slot_table_entries=128" > /etc/modprobe.d/sunrpc.conf

# Оптимизация размера буферов TCP
echo "Оптимизация сетевых буферов..."
sysctl -w net.core.rmem_default=262144 >/dev/null 2>&1
sysctl -w net.core.rmem_max=16777216 >/dev/null 2>&1
sysctl -w net.core.wmem_default=262144 >/dev/null 2>&1
sysctl -w net.core.wmem_max=16777216 >/dev/null 2>&1
sysctl -w net.core.netdev_max_backlog=300000 >/dev/null 2>&1

# Разгон файловой системы NFS
echo "Настройка оптимальных параметров монтирования NFS..."
mkdir -p /etc/modprobe.d/
echo "options nfs rsize=262144 wsize=262144
options nfs nfs4_disable_idmapping=1
options nfs noatime lookupcache=all" > /etc/modprobe.d/nfs-performance.conf

# Ускорение работы с NTFS
echo "Оптимизация драйвера NTFS..."
echo "options ntfs max_prealloc_size=64M
options ntfs big_writes=1
options ntfs compression=1" > /etc/modprobe.d/ntfs-performance.conf

# Применяем изменения
echo "Применение оптимизаций..."
sysctl -p >/dev/null 2>&1

# Копирование скрипта оптимизации на сервер NFS через ansible
echo -e "\n${GREEN}[2/5] Копирование скрипта оптимизации на сервер...${NC}"
SERVER_IP=$(grep -o "^[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+" inventory | head -1)
SERVER_USER=$(grep -o "ansible_user=\w\+" inventory | head -1 | cut -d= -f2)
SERVER_PASS=$(grep -o "ansible_ssh_pass=[^ ]\+" inventory | head -1 | cut -d= -f2)

if [ -z "$SERVER_IP" ] || [ -z "$SERVER_USER" ]; then
  echo -e "${RED}Ошибка: Не удалось получить IP-адрес или имя пользователя сервера из inventory${NC}"
  echo "Пожалуйста, проверьте файл inventory"
  exit 1
fi

# Создаем временный скрипт для сервера
TMP_SERVER_SCRIPT="/tmp/optimize-server.sh"
cat > $TMP_SERVER_SCRIPT << 'EOF'
#!/bin/bash
# Скрипт оптимизации для сервера NFS

# Для ускорения монтирования дисков
echo "Оптимизация кэша файловой системы..."
echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
echo 1024 > /proc/sys/vm/nr_hugepages 2>/dev/null || true

# Оптимизация параметров файловой системы
echo "Оптимизация параметров файловой системы..."
sysctl -w fs.file-max=500000 >/dev/null 2>&1
sysctl -w vm.dirty_ratio=80 >/dev/null 2>&1
sysctl -w vm.dirty_background_ratio=5 >/dev/null 2>&1
sysctl -w vm.dirty_expire_centisecs=12000 >/dev/null 2>&1

# Оптимизация сервера NFS
echo "Оптимизация параметров NFS сервера..."
sysctl -w fs.nfs.nlm_timeout=10 >/dev/null 2>&1 || true
sysctl -w sunrpc.tcp_slot_table_entries=128 >/dev/null 2>&1 || true
mkdir -p /etc/modprobe.d/
echo "options sunrpc tcp_slot_table_entries=128" > /etc/modprobe.d/sunrpc.conf

# Оптимизация сетевых буферов
echo "Оптимизация сетевых буферов..."
sysctl -w net.core.rmem_default=262144 >/dev/null 2>&1
sysctl -w net.core.rmem_max=16777216 >/dev/null 2>&1
sysctl -w net.core.wmem_default=262144 >/dev/null 2>&1
sysctl -w net.core.wmem_max=16777216 >/dev/null 2>&1
sysctl -w net.core.netdev_max_backlog=300000 >/dev/null 2>&1

# Ускорение сервера NFS
echo "options nfsd max_block_size=4096" > /etc/modprobe.d/nfsd-performance.conf
echo "options nfsd threads=16" >> /etc/modprobe.d/nfsd-performance.conf

# Применяем изменения
sysctl -p >/dev/null 2>&1

echo "Оптимизация сервера завершена!"
EOF

# Передаем скрипт на сервер и запускаем его
echo "Загрузка и запуск скрипта оптимизации на сервере: $SERVER_IP"
if [ -n "$SERVER_PASS" ]; then
  sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $TMP_SERVER_SCRIPT $SERVER_USER@$SERVER_IP:/tmp/optimize-server.sh 2>/dev/null
  sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $SERVER_USER@$SERVER_IP "chmod +x /tmp/optimize-server.sh && sudo /tmp/optimize-server.sh" 2>/dev/null
else
  scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $TMP_SERVER_SCRIPT $SERVER_USER@$SERVER_IP:/tmp/optimize-server.sh 2>/dev/null
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $SERVER_USER@$SERVER_IP "chmod +x /tmp/optimize-server.sh && sudo /tmp/optimize-server.sh" 2>/dev/null
fi

if [ $? -eq 0 ]; then
  echo -e "${GREEN}Оптимизация сервера успешно завершена!${NC}"
else
  echo -e "${YELLOW}Предупреждение: Не удалось выполнить оптимизацию сервера. Продолжаем...${NC}"
fi

# Очистка кэша фактов Ansible
echo -e "\n${GREEN}[3/5] Подготовка к запуску Ansible...${NC}"
echo "Очистка кэша фактов..."
rm -rf /tmp/ansible_fact_cache
mkdir -p /tmp/ansible_fact_cache

# Настройка оптимальных параметров среды для Ansible
export ANSIBLE_PIPELINING=True
export ANSIBLE_SSH_PIPELINING=True
export ANSIBLE_CACHE_PLUGIN=jsonfile
export ANSIBLE_CACHE_PLUGIN_CONNECTION=/tmp/ansible_fact_cache
export ANSIBLE_CACHE_PLUGIN_TIMEOUT=86400
export ANSIBLE_GATHERING=smart
export ANSIBLE_STRATEGY=free
export ANSIBLE_FORKS=20
export ANSIBLE_CALLBACK_WHITELIST=profile_tasks,timer
export ANSIBLE_STDOUT_CALLBACK=yaml
export ANSIBLE_GATHERING_TIMEOUT=30
export ANSIBLE_TIMEOUT=60
export ANSIBLE_POLL_INTERVAL=1
export ANSIBLE_DISPLAY_SKIPPED_HOSTS=false
export ANSIBLE_SSH_RETRIES=5
export ANSIBLE_DISPLAY_OK_HOSTS=false
export ANSIBLE_INTERNAL_POLL_INTERVAL=0.001

# Проверка доступности хостов
echo "Проверка доступности хостов..."
ALL_HOSTS=$(grep -E '^[0-9]+\.' inventory | awk '{print $1}')
for host in $ALL_HOSTS; do
  nc -z -w 2 $host 22 &>/dev/null
  if [ $? -eq 0 ]; then
    echo "✓ Хост $host доступен"
  else
    echo -e "${YELLOW}⚠ Хост $host недоступен! Убедитесь, что хост включен и доступен.${NC}"
  fi
done

# Запуск Ansible playbook
echo -e "\n${GREEN}[4/5] Запуск оптимизированного Ansible playbook...${NC}"
echo "Начало выполнения в $(date +"%H:%M:%S")"
START_TIME=$(date +%s)

# Проверка наличия sshpass
if ! command -v sshpass &> /dev/null; then
  echo "Установка sshpass для работы с паролями SSH..."
  apt-get update -qq && apt-get install -y sshpass -qq
fi

# Запуск playbook
ansible-playbook -i inventory playbook.yml --diff

# Расчет времени выполнения
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
MINUTES=$((TOTAL_TIME / 60))
SECONDS=$((TOTAL_TIME % 60))

# Итоговая информация
echo -e "\n${GREEN}[5/5] Операция завершена!${NC}"
echo -e "Время выполнения: ${YELLOW}${MINUTES}:${SECONDS}${NC} (${MINUTES} минут ${SECONDS} секунд)"

# Проверка статуса монтирования
echo -e "\n${GREEN}=== СТАТУС МОНТИРОВАНИЯ NFS ===${NC}"
df -h | grep -E "/mnt/storage|$SERVER_IP" || echo -e "${YELLOW}Нет смонтированных NFS разделов${NC}"

echo -e "\n${GREEN}Операция успешно завершена!${NC}"
echo "Ваши NFS разделы должны быть доступны в /mnt/storage/"