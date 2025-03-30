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
required_packages="python3 python3-pip netcat-openbsd openssh-client openssh-server nfs-common rpcbind iptables lsof"
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

# Решение проблемы с замаскированным nfs-common
echo "Проверка и настройка NFS-клиента..."
# Проверка, если nfs-common замаскирован
if systemctl status nfs-common 2>&1 | grep -q "masked"; then
    echo "nfs-common замаскирован. Выполняем альтернативную настройку NFS..."
    
    # Принудительное удаление ссылки маскирования
    find /etc/systemd/system -name "nfs*" -type l -delete 2>/dev/null || true
    
    # Принудительная переустановка пакетов NFS
    apt-get install --reinstall nfs-common -y
    
    # Перезагрузка системного менеджера
    systemctl daemon-reload
    
    # Запуск rpcbind вместо nfs-common
    systemctl restart rpcbind || /etc/init.d/rpcbind start || /sbin/rpcbind
fi

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
export ANSIBLE_CALLBACKS_ENABLED=profile_tasks,timer
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

# Принудительная очистка NFS перед запуском
echo "Очистка NFS состояния..."
umount -f -l -a -t nfs,nfs4 2>/dev/null || true
pgrep rpcbind >/dev/null || /sbin/rpcbind
rm -f /var/lib/nfs/etab /var/lib/nfs/rmtab /var/lib/nfs/state 2>/dev/null || true

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
# Дополнительная проверка монтирования после выполнения playbook
# Дополнительная проверка монтирования после выполнения playbook
if [ $PLAYBOOK_STATUS -ne 0 ] || ! df -h | grep -q "/mnt/storage"; then
    echo "Playbook завершился с ошибками или монтирование не выполнено. Выполняем дополнительные действия..."
    
    # Получение IP серверов NFS из inventory
    echo "Получение IP серверов NFS из inventory..."
    SERVER_IPS=($(grep -A 100 '^\[nfs_servers\]' inventory | grep -v '^\[' | grep -v '^#' | grep -v '^$' | awk '{print $1}' | head -n 10))
    
    if [ ${#SERVER_IPS[@]} -eq 0 ]; then
        echo "ОШИБКА: Не удалось определить IP серверов из inventory"
        exit 1
    fi
    
    echo "Найдено ${#SERVER_IPS[@]} NFS-серверов в inventory."
    
    # Словарь с буквами дисков
    declare -A DISK_LETTERS
    DISK_LETTERS=(["192.168.0.102/sda"]="C" ["192.168.0.102/sdb"]="D" ["192.168.0.106/sda"]="E" ["192.168.0.106/sdb"]="F")

    # Генерация конфигурации дисков для backend
    DISKS_CONFIG=""
    
    # Обработка каждого сервера
    for SERVER_IP in "${SERVER_IPS[@]}"; do
        echo "Обрабатываем сервер: $SERVER_IP"
        
        # Проверка доступности NFS сервера
        echo "Проверка доступности NFS сервера $SERVER_IP..."
        if ! nc -z -w 5 $SERVER_IP 2049; then
            echo "ПРЕДУПРЕЖДЕНИЕ: NFS порт на сервере $SERVER_IP недоступен!"
            echo "Проверяем статус NFS сервера..."
            
            # Пытаемся запустить NFS на сервере без запроса пароля
            # Используем настройки SSH из inventory
            ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 root@$SERVER_IP "
                systemctl restart nfs-server
                exportfs -r
                echo 'Экспорты на сервере:'
                exportfs -v
            " || echo "Не удалось подключиться к серверу или перезапустить NFS"
        fi

        # Проверка экспортов
        echo "Проверка доступных NFS экспортов на сервере $SERVER_IP..."
        EXPORTS=$(showmount -e $SERVER_IP 2>/dev/null || echo "Нет доступных экспортов")
        echo "$EXPORTS"

        if [[ "$EXPORTS" != *"Нет доступных экспортов"* ]]; then
            # Создание директории сервера
            SERVER_DIR="/mnt/storage/$SERVER_IP"
            mkdir -p "$SERVER_DIR"
            
            # Получаем список экспортов
            EXPORT_PATHS=$(echo "$EXPORTS" | grep -v "Export list" | awk '{print $1}')
            
            for EXPORT_PATH in $EXPORT_PATHS; do
                # Извлекаем имя диска из пути экспорта
                DISK_NAME=$(basename $EXPORT_PATH)
                
                # Создание точки монтирования
                MOUNT_POINT="$SERVER_DIR/$DISK_NAME"
                mkdir -p "$MOUNT_POINT"
                chmod 777 "$MOUNT_POINT"
                
                echo "Отключение существующего монтирования $MOUNT_POINT..."
                umount -f -l "$MOUNT_POINT" 2>/dev/null || true
                
                # Монтирование NFS шар с оптимальными параметрами
                echo "Монтирование $EXPORT_PATH с сервера $SERVER_IP в $MOUNT_POINT..."
                MOUNT_OPTS="vers=3,soft,nolock,rsize=8192,wsize=8192,nofail"
                mount -t nfs -o $MOUNT_OPTS "$SERVER_IP:$EXPORT_PATH" "$MOUNT_POINT"
                
                if mount | grep -q "$MOUNT_POINT"; then
                    echo "✓ Успешно смонтирован $DISK_NAME с сервера $SERVER_IP"
                    
                    # Получаем букву диска
                    DISK_KEY="$SERVER_IP/$DISK_NAME"
                    LETTER=${DISK_LETTERS[$DISK_KEY]:-"X"}
                    
                    # Добавляем диск в конфигурацию
                    DISKS_CONFIG="${DISKS_CONFIG}'$LETTER:': '/mnt/storage/$SERVER_IP/$DISK_NAME'\n"
                    
                    # Удаляем старую запись из fstab если есть
                    sed -i "\|$SERVER_IP:$EXPORT_PATH|d" /etc/fstab
                    
                    # Добавляем новую запись в fstab
                    echo "$SERVER_IP:$EXPORT_PATH $MOUNT_POINT nfs $MOUNT_OPTS 0 0" >> /etc/fstab
                else
                    echo "✗ Ошибка монтирования $DISK_NAME с сервера $SERVER_IP"
                fi
            done
        else
            echo "На сервере $SERVER_IP нет доступных экспортов"
        fi
    done
    
    # После обновления fstab необходимо обновить конфигурацию backend
    echo "Обновление конфигурации backend..."
    
    # Путь к конфигурации backend
    CONFIG_PATH="../backend/config/config.js"
    if [ -f "$CONFIG_PATH" ]; then
        echo "Найден файл конфигурации backend: $CONFIG_PATH"
        
        # Создание резервной копии
        cp "$CONFIG_PATH" "${CONFIG_PATH}.bak"
        
        # Удаляем лишние пробелы в конце DISKS_CONFIG
        DISKS_CONFIG=$(echo -e "$DISKS_CONFIG" | sed 's/,$//')
        
# Полностью перестраиваем формат вывода дисков
FORMATTED_DISKS=""
LAST_INDEX=$(echo -e "$DISKS_CONFIG" | wc -l)
CURRENT=0

while IFS= read -r line; do
  CURRENT=$((CURRENT+1))
  # Убираем лишние пробелы и добавляем запятую для всех строк, кроме последней
  FORMATTED_LINE=$(echo "$line" | sed 's/^ */            /')
  if [ $CURRENT -lt $LAST_INDEX ]; then
    FORMATTED_DISKS="${FORMATTED_DISKS}${FORMATTED_LINE},\n"
  else
    FORMATTED_DISKS="${FORMATTED_DISKS}${FORMATTED_LINE}\n"
  fi
done <<< "$DISKS_CONFIG"

# Создаем временный файл конфигурации с правильным форматированием
cat > "$CONFIG_PATH" << EOF
// Конфигурация приложения
const config = {
  // Базовые настройки
  server: {
    port: process.env.PORT || 6005,
    allowedOrigins: [
      'http://46.35.241.37:6001', 
      'http://localhost:6001',
      'https://iqbanana.online',
      'http://iqbanana.online'
    ]
  },
  
  // Версия API
  apiVersion: 'v1',
  
  // Пути к смонтированным дискам на веб-сервере
  disks: {
$(echo -e "$FORMATTED_DISKS")
  },
  
  // Настройки производительности для файловых операций
  performance: {
    maxFileSize: 20 * 1024 * 1024 * 1024, // 20GB максимальный размер файла
    chunkSize: 5 * 1024 * 1024, // 5MB размер чанка по умолчанию для больших файлов
    maxConcurrentUploads: 5, // Максимальное количество одновременных загрузок
    uploadTimeout: 3600000, // 1 час таймаут для загрузки полного файла
    chunkTimeout: 600000, // 10 минут таймаут для загрузки чанка
    readBufferSize: 4096 * 1024, // 4 MB буфер для чтения файлов
    writeBufferSize: 8192 * 1024 // 8 MB буфер для записи файлов
  }
};

module.exports = config;
EOF
        
        echo "✓ Конфигурация backend обновлена успешно"
        echo "Содержимое конфигурации дисков:"
        grep -A 10 "disks: {" "$CONFIG_PATH"
    else
        echo "⚠️ Файл конфигурации backend не найден: $CONFIG_PATH"
    fi
    
    # Перезагрузка systemd
    systemctl daemon-reload
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