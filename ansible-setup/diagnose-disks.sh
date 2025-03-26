#!/bin/bash

# Скрипт для диагностики дисков и монтирования NFS
# Запускается для отладки проблем с монтированием

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== ДИАГНОСТИКА МОНТИРОВАНИЯ ДИСКОВ И NFS ===${NC}"

# Проверка, запущен ли скрипт с правами root
if [ "$EUID" -ne 0 ]; then
  echo -e "${YELLOW}Внимание: Для полной диагностики рекомендуется запускать с правами root${NC}"
fi

# Функция для отображения заголовка секции
section() {
  echo -e "\n${GREEN}=== $1 ===${NC}"
}

# Функция для выполнения команды с выводом результата
run_cmd() {
  echo -e "${YELLOW}$ $1${NC}"
  eval "$1"
}

section "ИНФОРМАЦИЯ О СИСТЕМЕ"
run_cmd "hostname -f"
run_cmd "uname -a"
run_cmd "ip addr show | grep inet"

section "БЛОЧНЫЕ УСТРОЙСТВА"
run_cmd "lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE"
run_cmd "fdisk -l | grep -E 'Disk /dev/[a-z]d[a-z]'"

section "СИСТЕМНЫЕ ДИСКИ"
run_cmd "findmnt / -o SOURCE"
run_cmd "cat /proc/swaps | grep -v Filename"
run_cmd "mount | grep -E '^/dev'"

section "НЕСИСТЕМНЫЕ ДИСКИ"
echo "Определение несистемных дисков..."
ROOT_DISK=$(lsblk -no pkname $(findmnt -n -o SOURCE /))
echo "Системный диск: /dev/${ROOT_DISK}"

ALL_DISKS=$(lsblk -dpno NAME | grep -E '^/dev/[a-z]d[a-z]$')
echo "Все диски: $ALL_DISKS"

NONSYS_DISKS=""
for disk in $ALL_DISKS; do
  if [[ ! "$disk" =~ "/dev/$ROOT_DISK" ]]; then
    NONSYS_DISKS="$NONSYS_DISKS $disk"
    echo "Обнаружен несистемный диск: $disk"
    
    # Проверяем, есть ли у диска файловая система
    FS_TYPE=$(blkid -s TYPE -o value $disk 2>/dev/null || echo "none")
    echo "  Файловая система: $FS_TYPE"
    
    # Проверяем, есть ли на диске разделы
    PARTS=$(lsblk $disk -no NAME,TYPE | grep part | wc -l)
    echo "  Количество разделов: $PARTS"
    
    # Проверяем, примонтирован ли диск
    MOUNT=$(lsblk $disk -no MOUNTPOINT | grep -v "^$" | head -1)
    if [ -z "$MOUNT" ]; then
      echo "  Статус: Не примонтирован"
    else
      echo "  Примонтирован в: $MOUNT"
    fi
  fi
done

if [ -z "$NONSYS_DISKS" ]; then
  echo "Несистемные диски не обнаружены"
fi

section "NFS СЕРВЕР (если установлен)"
if command -v exportfs &> /dev/null; then
  run_cmd "systemctl status nfs-kernel-server"
  run_cmd "exportfs -v"
  run_cmd "cat /etc/exports"
else
  echo "NFS сервер не установлен"
fi

section "NFS КЛИЕНТ"
if command -v showmount &> /dev/null; then
  # Получаем IP сервера из inventory
  SERVER_IP=$(grep -o "^[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+" inventory | head -1)
  if [ -n "$SERVER_IP" ]; then
    run_cmd "showmount -e $SERVER_IP"
  else
    echo "IP-адрес сервера не найден в inventory"
  fi
  run_cmd "mount | grep nfs"
  run_cmd "cat /proc/mounts | grep nfs"
else
  echo "NFS клиент не установлен"
fi

section "РЕКОМЕНДАЦИИ"
echo "Рекомендации на основе диагностики:"

if [ -z "$NONSYS_DISKS" ]; then
  echo "✗ Проблема: Несистемные диски не обнаружены"
  echo "  Решение: Убедитесь, что в системе есть дополнительные диски, кроме системного"
else
  echo "✓ Обнаружены несистемные диски: $NONSYS_DISKS"
  
  # Проверяем файловые системы
  for disk in $NONSYS_DISKS; do
    FS_TYPE=$(blkid -s TYPE -o value $disk 2>/dev/null || echo "none")
    if [ "$FS_TYPE" == "none" ]; then
      echo "✗ Диск $disk не имеет файловой системы"
      echo "  Решение: Создайте файловую систему командой: mkfs.ext4 $disk"
    else
      echo "✓ Диск $disk имеет файловую систему $FS_TYPE"
    fi
    
    # Проверяем монтирование
    MOUNT=$(lsblk $disk -no MOUNTPOINT | grep -v "^$" | head -1)
    if [ -z "$MOUNT" ]; then
      echo "✗ Диск $disk не примонтирован"
      echo "  Решение: Смонтируйте диск в каталог /mnt/storage/$(basename $disk)"
    fi
  done
fi

# Проверка NFS сервера
if ! command -v exportfs &> /dev/null; then
  echo "✗ NFS сервер не установлен"
  echo "  Решение: Установите пакет nfs-kernel-server"
elif ! systemctl is-active --quiet nfs-kernel-server; then
  echo "✗ NFS сервер не запущен"
  echo "  Решение: Запустите NFS сервер: systemctl start nfs-kernel-server"
fi

# Проверка экспортов NFS
if command -v exportfs &> /dev/null; then
  EXPORTS=$(exportfs -v | wc -l)
  if [ "$EXPORTS" -eq 0 ]; then
    echo "✗ Нет экспортированных NFS файловых систем"
    echo "  Решение: Настройте экспорты в файле /etc/exports и выполните exportfs -ra"
  fi
fi

# Проверка NFS клиента
if ! command -v showmount &> /dev/null; then
  echo "✗ NFS клиент не установлен"
  echo "  Решение: Установите пакет nfs-common"
else
  NFS_MOUNTS=$(mount | grep nfs | wc -l)
  if [ "$NFS_MOUNTS" -eq 0 ]; then
    echo "✗ Нет смонтированных NFS файловых систем"
    SERVER_IP=$(grep -o "^[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+" inventory | head -1)
    if [ -n "$SERVER_IP" ]; then
      EXPORTS=$(showmount -e $SERVER_IP 2>/dev/null | grep -v "Export list" | wc -l)
      if [ "$EXPORTS" -eq 0 ]; then
        echo "  Причина: Нет доступных экспортов на сервере $SERVER_IP"
      else
        echo "  Решение: Смонтируйте доступные экспорты с сервера $SERVER_IP"
      fi
    fi
  fi
fi

section "ДИАГНОСТИКА СЕТИ"
SERVER_IP=$(grep -o "^[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+" inventory | head -1)
if [ -n "$SERVER_IP" ]; then
  run_cmd "ping -c 3 $SERVER_IP"
  run_cmd "nc -z -v $SERVER_IP 2049 2>&1 || echo 'Порт NFS недоступен'"
fi

section "ЗАВЕРШЕНИЕ ДИАГНОСТИКИ"
echo "Диагностика завершена. Используйте информацию выше для устранения проблем с монтированием NFS."
echo -e "${GREEN}Для автоматического исправления проблем запустите:${NC}"
echo -e "${YELLOW}sudo bash ansible-setup-tuned.sh${NC}"