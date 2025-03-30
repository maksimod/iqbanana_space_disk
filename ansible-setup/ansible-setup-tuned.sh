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

# Проверка прав пользователя
if [ "$(id -u)" -ne 0 ]; then
    echo "ОШИБКА: Этот скрипт должен быть запущен с правами root."
    echo "Используйте: sudo $0"
    exit 1
fi

# Проверка наличия и установка необходимых зависимостей
echo "Проверка и установка необходимых зависимостей..."
apt-get update -qq

# Проверка и установка Ansible
if ! command -v ansible >/dev/null 2>&1; then
    echo "Установка Ansible..."
    apt-get install -y ansible
fi

# Проверка и установка sshpass для работы с паролями в SSH
if ! command -v sshpass >/dev/null 2>&1; then
    echo "Установка sshpass для поддержки соединения по SSH с паролем..."
    apt-get install -y sshpass
fi

# Проверка и установка других необходимых пакетов
required_packages="python3 python3-pip netcat-openbsd openssh-client openssh-server nfs-common rpcbind iptables"
for pkg in $required_packages; do
    if ! dpkg -l | grep -q "ii  $pkg"; then
        echo "Установка пакета $pkg..."
        apt-get install -y $pkg
    fi
done

# Установка необходимых модулей Python
echo "Установка необходимых модулей Python..."
apt-get install -y python3-paramiko python3-jinja2 python3-yaml

# Очистка кэша фактов
echo "Очистка кэша фактов..."
rm -rf /tmp/ansible_fact_cache
mkdir -p /tmp/ansible_fact_cache
chmod 700 /tmp/ansible_fact_cache

# Размаскирование nfs-common, если он замаскирован на клиенте
echo "Проверка и размаскирование необходимых служб..."
systemctl unmask nfs-common 2>/dev/null || true
systemctl unmask rpcbind 2>/dev/null || true

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
export ANSIBLE_HOST_KEY_CHECKING=False

# Дополнительные оптимизации
if [ "$PARALLEL" = true ]; then
    export ANSIBLE_GATHERING_TIMEOUT=30
    export ANSIBLE_TIMEOUT=60
    export ANSIBLE_POLL_INTERVAL=1
    export ANSIBLE_DISPLAY_SKIPPED_HOSTS=false
    export ANSIBLE_SSH_RETRIES=5
    export ANSIBLE_DISPLAY_OK_HOSTS=false
fi

# Применение системных оптимизаций
echo "Применение системных оптимизаций..."
echo 3 > /proc/sys/vm/drop_caches
sysctl -w vm.dirty_ratio=80 >/dev/null 2>&1
sysctl -w vm.dirty_background_ratio=5 >/dev/null 2>&1
sysctl -w vm.dirty_expire_centisecs=12000 >/dev/null 2>&1
sysctl -w sunrpc.tcp_slot_table_entries=128 >/dev/null 2>&1
sysctl -w net.core.rmem_default=262144 >/dev/null 2>&1
sysctl -w net.core.wmem_default=262144 >/dev/null 2>&1
sysctl -w net.core.rmem_max=16777216 >/dev/null 2>&1
sysctl -w net.core.wmem_max=16777216 >/dev/null 2>&1

# Проверка SSH-соединения перед запуском
echo "Проверка SSH-соединения с хостами..."
for host in $(grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' inventory | awk '{print $1}'); do
    nc -z -w 2 $host 22 &> /dev/null
    if [ $? -eq 0 ]; then
        echo "SSH доступен для $host"
    else
        echo "ПРЕДУПРЕЖДЕНИЕ: SSH недоступен для $host, проверьте настройки подключения"
        echo "Продолжить? (y/n)"
        read cont
        if [ "$cont" != "y" ]; then
            echo "Прерывание..."
            exit 1
        fi
    fi
done

# Включаем подсчет времени
START_TIME=$(date +%s)

# Запуск playbook с оптимальными параметрами
echo "Запуск оптимизированного playbook со стратегией $STRATEGY и $FORKS форками..."
ansible-playbook -i inventory playbook.yml --diff "$@"

# Проверка статуса выполнения
PLAYBOOK_STATUS=$?

# Дополнительная проверка монтирования после выполнения playbook
if [ $PLAYBOOK_STATUS -ne 0 ]; then
    echo "Playbook завершился с ошибками. Выполняем дополнительные действия..."
    
    # Очистка устаревших дескрипторов файлов
    echo "Очистка устаревших дескрипторов файлов NFS..."
    service nfs-common restart
    service rpcbind restart
    sleep 2
    rm -f /var/lib/nfs/state 2>/dev/null || true
    service nfs-common restart
    
    # Принудительное размонтирование всех NFS-монтирований
    echo "Принудительное размонтирование всех NFS-монтирований..."
    for mount in $(mount | grep nfs | awk '{print $3}'); do
        echo "Размонтирование $mount..."
        umount -f -l $mount 2>/dev/null || true
    done
    
    # Проверка смонтированных дисков
    if ! mount | grep -q "/mnt/storage"; then
        echo "Пытаемся смонтировать NFS вручную..."
        
        # Получаем IP сервера из inventory
        SERVER_IP=$(grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' inventory | head -1 | awk '{print $1}')
        if [ -n "$SERVER_IP" ]; then
            # Проверяем доступность экспортов
            echo "Доступные экспорты на сервере:"
            showmount -e $SERVER_IP || echo "Не удалось получить список экспортов"
            
            # Пробуем монтировать с разными параметрами
            for disk in sda sdb; do
                echo "Пробуем смонтировать $disk..."
                mkdir -p /mnt/storage/$disk
                chmod 777 /mnt/storage/$disk
                
                # Используем более надежные параметры монтирования
                echo "  Попытка монтирования с оптимальными параметрами..."
                mount -t nfs -o rw,hard,intr,noatime,timeo=600,retrans=2,noresvport $SERVER_IP:/mnt/storage/$disk /mnt/storage/$disk 2>/dev/null
                
                if ! mount | grep -q "/mnt/storage/$disk"; then
                    # Попытка с опциями NFS v3
                    echo "  Попытка с NFS v3..."
                    mount -t nfs -o rw,hard,intr,noatime,vers=3 $SERVER_IP:/mnt/storage/$disk /mnt/storage/$disk 2>/dev/null
                fi
                
                if ! mount | grep -q "/mnt/storage/$disk"; then
                    # Попытка с опциями NFS v4
                    echo "  Попытка с NFS v4..."
                    mount -t nfs -o rw,hard,intr,noatime,vers=4 $SERVER_IP:/mnt/storage/$disk /mnt/storage/$disk 2>/dev/null
                fi
                
                if ! mount | grep -q "/mnt/storage/$disk"; then
                    # Последняя попытка с минимальными опциями
                    echo "  Последняя попытка с минимальными опциями..."
                    mount -t nfs $SERVER_IP:/mnt/storage/$disk /mnt/storage/$disk 2>/dev/null
                fi
                
                if mount | grep -q "/mnt/storage/$disk"; then
                    echo "  ✓ Диск $disk успешно смонтирован"
                else
                    echo "  ✗ Не удалось смонтировать диск $disk"
                fi
            done
        else
            echo "Не удалось определить IP сервера NFS из inventory"
        fi
    fi
fi

# Подсчет общего времени выполнения
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

# Вывод времени работы скрипта
echo "Скрипт выполнен за ${MINUTES}:${SECONDS} (${MINUTES} минут ${SECONDS} секунд)!"

# Вывод сводной информации о смонтированных дисках
echo "Смонтированные NFS диски:"
df -h | grep -E "/mnt/storage|nfs" || echo "NFS диски не смонтированы!"

exit $PLAYBOOK_STATUS