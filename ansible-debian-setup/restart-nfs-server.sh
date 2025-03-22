#!/bin/bash
# Скрипт для ручного перезапуска NFS сервера
# Должен запускаться с правами root (sudo)

echo "Перезапуск NFS сервера..."

# Проверка прав root
if [ "$EUID" -ne 0 ]; then
  echo "Ошибка: Скрипт должен запускаться с правами root (sudo $0)"
  exit 1
fi

# Остановка сервисов NFS в правильном порядке
echo "Остановка сервисов NFS..."
systemctl stop nfs-kernel-server
systemctl stop nfs-mountd
systemctl stop nfs-idmapd
systemctl stop rpcbind

# Небольшая пауза
sleep 2

# Загрузка модулей ядра для NFS
echo "Загрузка модулей ядра..."
modprobe nfs
modprobe nfsd

# Запуск сервисов в правильном порядке
echo "Запуск сервисов NFS..."
systemctl start rpcbind
sleep 1
systemctl start nfs-idmapd
sleep 1
systemctl start nfs-mountd
sleep 1
systemctl start nfs-kernel-server

# Применение экспортов
echo "Применение экспортов..."
exportfs -ra

# Проверка статуса
echo "Статус сервисов NFS:"
systemctl status rpcbind --no-pager
systemctl status nfs-kernel-server --no-pager

# Вывод текущих экспортов
echo "Текущие экспорты NFS:"
exportfs -v

# Проверка прослушиваемых портов
echo "Прослушиваемые порты NFS:"
rpcinfo -p localhost | grep -E 'nfs|mount|portmapper'

echo "Перезапуск NFS сервера завершен"
exit 0 