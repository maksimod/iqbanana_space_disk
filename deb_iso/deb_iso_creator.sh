#!/bin/bash

# Конфигурация
set -e

# Параметры по умолчанию
DEBIAN_VERSION="${DEBIAN_VERSION:-bullseye}"
ARCH="${ARCH:-i386}"
LOCAL_ISO_PATH="${LOCAL_ISO_PATH:-mini.iso}"
MIRROR="${MIRROR:-https://deb.debian.org/debian/dists/${DEBIAN_VERSION}/main/installer-${ARCH}/current/images/netboot}"

# Имена файлов
BASE_ISO_NAME="debian-${DEBIAN_VERSION}-${ARCH}-netboot.iso"
CUSTOM_ISO_NAME="custom-debian-${DEBIAN_VERSION}-${ARCH}-preseed.iso"
PRESEED_NAME="preseed.cfg"
LOG_FILE="/tmp/debian_iso_creator.log"

# Очистка временных файлов
cleanup() {
    rm -rf netboot* iso_root* mnt* custom 2>/dev/null || true
}
trap cleanup EXIT

# Логирование
log() {
    local message="[$(date +'%Y-%m-%d %H:%M:%S')] $*"
    echo "$message" | tee -a "$LOG_FILE"
}

# Выполнение команд с логированием
run_cmd() {
    log "Выполнение: $*"
    if "$@" 2>&1 | tee -a "$LOG_FILE"; then
        log "Команда выполнена успешно"
        return 0
    else
        log "ОШИБКА при выполнении команды"
        return 1
    fi
}

# Проверка зависимостей
check_deps() {
    local deps=("xorriso" "tar" "genisoimage" "syslinux")
    
    # Добавляем wget только если нужна сетевая загрузка
    [[ ! -f "$LOCAL_ISO_PATH" ]] && deps+=("wget")
    
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log "КРИТИЧЕСКАЯ ОШИБКА: $dep не установлен"
            exit 1
        fi
    done
}

# Подготовка образа
prepare_iso() {
    # Используем локальный ISO если существует
    if [[ -f "$LOCAL_ISO_PATH" ]]; then
        log "Используется локальный ISO: $LOCAL_ISO_PATH"
        
        # Создание директорий
        run_cmd mkdir -p mnt custom custom/isolinux
        
        # Монтирование локального ISO
        run_cmd mount -o loop "$LOCAL_ISO_PATH" mnt
        
        # Копирование всего содержимого
        run_cmd cp -r mnt/* custom/
        
        # Поиск и копирование загрузочных файлов
        local boot_files=(
            "isolinux.bin"
            "ldlinux.c32"
            "libcom32.c32"
            "libutil.c32"
            "vesamenu.c32"
        )
        
        for file in "${boot_files[@]}"; do
            local found=0
            for search_path in \
                "custom/$file" \
                "custom/isolinux/$file" \
                "custom/boot/$file" \
                "/usr/lib/syslinux/modules/bios/$file" \
                "/usr/share/syslinux/$file"
            do
                if [[ -f "$search_path" ]]; then
                    run_cmd cp "$search_path" "custom/isolinux/$file"
                    found=1
                    break
                fi
            done
            
            if [[ $found -eq 0 ]]; then
                log "ПРЕДУПРЕЖДЕНИЕ: Не найден файл $file"
            fi
        done
        
        # Размонтирование
        run_cmd umount mnt
        
        return 0
    fi
}

# Создание preseed-файла
create_preseed() {
    log "Создание preseed-файла..."
    cat > "$PRESEED_NAME" << EOF
# Автоматическая установка Debian
d-i debian-installer/locale string en_US.UTF-8
d-i keyboard-configuration/layoutcode string us

# Сетевые настройки
d-i netcfg/choose_interface select auto

# Зеркало Debian
d-i mirror/country string manual
d-i mirror/http/hostname string deb.debian.org
d-i mirror/http/directory string /debian
d-i mirror/http/proxy string

# Разметка диска
d-i partman-auto/method string regular
d-i partman-auto/choose_recipe select atomic
d-i partman/confirm boolean true

# Часовой пояс
d-i time/zone string UTC

# Пользователь
d-i passwd/make-user boolean true
d-i passwd/user-fullname string Debian User
d-i passwd/username string debian
d-i passwd/user-password password debian
d-i passwd/user-password-again password debian
d-i user-setup/allow-password-weak boolean true

# Пакеты
tasksel tasksel/first multiselect standard
d-i pkgsel/include string openssh-server wget curl
d-i pkgsel/upgrade select full-upgrade

# Загрузчик
d-i grub-installer/only_debian boolean true
d-i grub-installer/with_other_os boolean false

# Завершение установки
d-i finish-install/reboot_in_progress note
d-i debian-installer/exit/halt boolean false
d-i debian-installer/exit/poweroff boolean false
EOF
}

# Встраивание preseed в ISO
embed_preseed() {
    log "Встраивание preseed-файла в ISO..."
    
    # Копирование preseed
    run_cmd cp "$PRESEED_NAME" custom/
    
    # Создание загрузочного конфига
    local isolinux_cfg="custom/isolinux/isolinux.cfg"
    
    # Создаем новый конфиг с параметрами автоматической установки
    cat > "$isolinux_cfg" << EOF
default install
prompt 0
timeout 0

label install
  menu label ^Automated Install
  menu default
  kernel /linux
  append initrd=/initrd.gz auto=true priority=critical preseed/file=/preseed.cfg
EOF
    
    # Создание нового ISO
    run_cmd genisoimage -r -J \
        -b isolinux/isolinux.bin \
        -c isolinux/boot.cat \
        -no-emul-boot \
        -boot-load-size 4 \
        -boot-info-table \
        -o "$CUSTOM_ISO_NAME" \
        custom/
    
    # Проверка создания ISO
    if [[ -f "$CUSTOM_ISO_NAME" ]]; then
        log "ISO успешно создан: $CUSTOM_ISO_NAME"
        log "Размер ISO: $(du -h "$CUSTOM_ISO_NAME" | cut -f1)"
    else
        log "ОШИБКА: ISO не был создан"
        exit 1
    fi
}

# Основная функция
main() {
    # Очистка лог-файла
    > "$LOG_FILE"
    
    log "СТАРТ СОЗДАНИЯ DEBIAN ISO"
    log "Версия: $DEBIAN_VERSION"
    log "Архитектура: $ARCH"
    log "Источник ISO: ${LOCAL_ISO_PATH}"
    
    check_deps
    prepare_iso
    create_preseed
    embed_preseed
    
    log "СКРИПТ ЗАВЕРШЕН УСПЕШНО"
}

# Запуск
main