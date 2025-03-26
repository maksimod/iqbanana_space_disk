#!/bin/bash
echo "Перемонтирование NFS с высокопроизводительными параметрами..."

# Размонтируем все NFS каталоги
for mount in $(mount | grep nfs | awk '{print $3}'); do
  echo "Размонтирование $mount"
  umount -f $mount 2>/dev/null || umount -l $mount
done

# Перемонтируем с оптимизированными параметрами для высокой скорости
mkdir -p /mnt/storage/sdb /mnt/storage/sdc

# Оптимизированные параметры для быстрых операций с файлами
# - actimeo=1: уменьшаем время кэширования атрибутов для быстрого обновления
# - nocto: отключаем проверку времени изменения для каждой операции
# - noac: отключаем кэширование атрибутов для мгновенного обновления
# - lookupcache=none: отключаем кэш поиска для актуальных данных
# - noatime: не обновляем время доступа к файлам
# - nodiratime: не обновляем время доступа к директориям
# - bg: монтирование в фоне для ускорения загрузки
# - timeo=5: быстрый таймаут для операций
# - retrans=1: меньше повторных попыток для быстрого пропуска ошибок
# - tcp: используем TCP для стабильности

# Производительные опции (для быстрой загрузки)
mount -t nfs -o rw,soft,timeo=5,retrans=1,noatime,nodiratime,_netdev,rsize=1048576,wsize=1048576,nconnect=16,actimeo=1,nocto,noac,lookupcache=none,tcp,bg,nofail 192.168.0.108:/mnt/storage/sdb /mnt/storage/sdb
mount -t nfs -o rw,soft,timeo=5,retrans=1,noatime,nodiratime,_netdev,rsize=1048576,wsize=1048576,nconnect=16,actimeo=1,nocto,noac,lookupcache=none,tcp,bg,nofail 192.168.0.108:/mnt/storage/sdc /mnt/storage/sdc

# Применим оптимизации системы
echo 3 > /proc/sys/vm/drop_caches
sysctl -w vm.dirty_ratio=80
sysctl -w vm.dirty_background_ratio=5
sysctl -w vm.dirty_expire_centisecs=12000
sysctl -w sunrpc.tcp_slot_table_entries=128
sysctl -w net.core.rmem_default=262144
sysctl -w net.core.wmem_default=262144
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216
sysctl -w net.ipv4.tcp_wmem="4096 65536 16777216"
sysctl -w net.ipv4.tcp_rmem="4096 65536 16777216"
sysctl -w net.ipv4.tcp_moderate_rcvbuf=1

# Проверяем результат
echo "Статус монтирования:"
mount | grep nfs

echo "Применены оптимизации для высокоскоростной передачи файлов!"