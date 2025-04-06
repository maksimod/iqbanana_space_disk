#!/bin/bash

# Скрипт для восстановления бэкапа на сервере
# Использование: restore_backup.sh <имя_диска> <uuid_диска> <путь_к_бэкапу>

DISK_NAME="$1"
DISK_UUID="$2"
BACKUP_PATH="$3"

LOG_FILE="/tmp/restore_${DISK_NAME}_$(date +%Y%m%d_%H%M%S).log"
STATUS_FILE="/tmp/restore_${DISK_NAME}_status.txt"

# Начальный статус
echo "PROCESSING" > "$STATUS_FILE"

# Функция для логирования с датой и временем
log() {
  echo "$(date +"%Y-%m-%d %H:%M:%S") - $1" | tee -a "$LOG_FILE"
}

log "Начало восстановления бэкапа: $(basename ${BACKUP_PATH})"
log "Полный путь к бэкапу: ${BACKUP_PATH}"
log "UUID диска: ${DISK_UUID}"

# Проверяем существование файла бэкапа
if [ ! -f "${BACKUP_PATH}" ]; then
  log "ОШИБКА: Файл бэкапа ${BACKUP_PATH} не найден на сервере"
  echo "ERROR" > "$STATUS_FILE"
  exit 1
fi

# Вывести информацию о размере бэкапа
BACKUP_SIZE=$(du -h "${BACKUP_PATH}" | cut -f1)
log "Размер бэкапа: $BACKUP_SIZE"

# Проверяем тип файла
log "Проверка типа файла ${BACKUP_PATH}..."
FILE_TYPE=$(file -b "${BACKUP_PATH}")
log "Тип файла: $FILE_TYPE"

# Основной путь к диску на сервере
TARGET_DIR="/mnt/storage/${DISK_UUID}"
# Альтернативный путь
ALT_TARGET_DIR="/mnt/storage/sdb"

log "Основная целевая директория: $TARGET_DIR"
log "Альтернативная целевая директория: $ALT_TARGET_DIR"

# Определяем доступную директорию
if [ -d "$TARGET_DIR" ]; then
  RESTORE_DIR="$TARGET_DIR"
  log "Используем основную директорию: $RESTORE_DIR"
elif [ -d "$ALT_TARGET_DIR" ]; then
  RESTORE_DIR="$ALT_TARGET_DIR"
  log "Используем альтернативную директорию: $RESTORE_DIR"
else
  log "ОШИБКА: Ни одна из целевых директорий не существует"
  log "Пытаемся создать основную директорию $TARGET_DIR"
  mkdir -p "$TARGET_DIR"
  if [ $? -eq 0 ]; then
    RESTORE_DIR="$TARGET_DIR"
    log "Успешно создана директория: $RESTORE_DIR"
  else
    log "ОШИБКА: Не удалось создать директорию $TARGET_DIR"
    log "Пытаемся создать альтернативную директорию $ALT_TARGET_DIR"
    mkdir -p "$ALT_TARGET_DIR"
    if [ $? -eq 0 ]; then
      RESTORE_DIR="$ALT_TARGET_DIR"
      log "Успешно создана альтернативная директория: $RESTORE_DIR"
    else
      log "ОШИБКА: Не удалось создать ни одну директорию"
      echo "ERROR" > "$STATUS_FILE"
      exit 1
    fi
  fi
fi

# Проверяем свободное место на диске
log "Проверка свободного места на диске..."
FREE_SPACE=$(df -h "$RESTORE_DIR" | tail -1 | awk '{print $4}')
log "Свободное место: $FREE_SPACE"

# Очистка целевой директории перед восстановлением
log "Очистка целевой директории..."
rm -rf "$RESTORE_DIR"/* "$RESTORE_DIR"/.[!.]*

# Создаем временную директорию для анализа структуры
TEMP_DIR=$(mktemp -d)
log "Создана временная директория: $TEMP_DIR"

# Флаг успешного восстановления
SUCCESS=0

# МЕТОД 1: Стандартная распаковка tar.gz с удалением первого уровня каталогов
if [[ "$FILE_TYPE" == *"gzip compressed data"* || "$FILE_TYPE" == *"tar archive"* ]]; then
  log "Метод 1: Анализ структуры архива и распаковка tar-архива..."
  
  # Смотрим структуру архива
  if [[ "$FILE_TYPE" == *"gzip compressed data"* ]]; then
    tar -tzf "${BACKUP_PATH}" | head -10 > "$TEMP_DIR/file_list.txt"
  else
    tar -tf "${BACKUP_PATH}" | head -10 > "$TEMP_DIR/file_list.txt"
  fi
  
  log "Первые файлы в архиве:"
  cat "$TEMP_DIR/file_list.txt" | tee -a "$LOG_FILE"
  
  # Определяем, нужно ли удалять первый уровень каталогов
  STRIP_COMPONENTS=0
  FIRST_ENTRY=$(head -1 "$TEMP_DIR/file_list.txt")
  
  # Если первый файл - директория, используем --strip-components=1
  if [[ "$FIRST_ENTRY" == */ ]]; then
    log "Первый элемент в архиве - директория, будем удалять первый уровень каталогов"
    STRIP_COMPONENTS=1
  elif [[ "$FIRST_ENTRY" == */* ]]; then
    # Проверяем, если все файлы имеют одинаковый первый каталог
    PREFIX=$(echo "$FIRST_ENTRY" | cut -d'/' -f1)
    ALL_MATCH=$(grep -v "^$PREFIX/" "$TEMP_DIR/file_list.txt" | wc -l)
    
    if [ $ALL_MATCH -eq 0 ]; then
      log "Все файлы имеют общий префикс '$PREFIX', будем удалять первый уровень каталогов"
      STRIP_COMPONENTS=1
    fi
  fi
  
  # Распаковка архива с/без удаления первого уровня каталогов
  if [ $STRIP_COMPONENTS -eq 1 ]; then
    log "Распаковка с удалением первого уровня каталогов..."
    if [[ "$FILE_TYPE" == *"gzip compressed data"* ]]; then
      tar --strip-components=1 -xzf "${BACKUP_PATH}" -C "$RESTORE_DIR"
    else
      tar --strip-components=1 -xf "${BACKUP_PATH}" -C "$RESTORE_DIR"
    fi
  else
    log "Распаковка без удаления первого уровня каталогов..."
    if [[ "$FILE_TYPE" == *"gzip compressed data"* ]]; then
      tar -xzf "${BACKUP_PATH}" -C "$RESTORE_DIR"
    else
      tar -xf "${BACKUP_PATH}" -C "$RESTORE_DIR"
    fi
  fi
  
  # Проверяем результат
  if [ $? -eq 0 ]; then
    log "Распаковка успешно завершена"
    SUCCESS=1
  else
    log "Ошибка при распаковке архива методом 1"
  fi
fi

# МЕТОД 2: Используем двухэтапный подход (если метод 1 не сработал)
if [ $SUCCESS -eq 0 ] && [[ "$FILE_TYPE" == *"gzip compressed data"* ]]; then
  log "Метод 2: Двухэтапная распаковка (gunzip + tar)..."
  
  # Копируем архив во временную директорию
  cp "${BACKUP_PATH}" "$TEMP_DIR/"
  BACKUP_FILENAME=$(basename "${BACKUP_PATH}")
  
  # Распаковываем gzip
  log "Распаковка gzip архива..."
  gunzip -f "$TEMP_DIR/$BACKUP_FILENAME"
  
  # Проверяем, создался ли tar-файл
  TAR_FILE="$TEMP_DIR/$(basename "${BACKUP_FILENAME}" .gz)"
  if [ -f "$TAR_FILE" ]; then
    log "Файл распакован, теперь распаковываем tar: $TAR_FILE"
    
    # Смотрим структуру tar-архива
    tar -tf "$TAR_FILE" | head -10 > "$TEMP_DIR/tar_file_list.txt"
    log "Содержимое tar архива:"
    cat "$TEMP_DIR/tar_file_list.txt" | tee -a "$LOG_FILE"
    
    # Определяем, нужно ли удалять первый уровень каталогов
    STRIP_COMPONENTS=0
    FIRST_ENTRY=$(head -1 "$TEMP_DIR/tar_file_list.txt")
    
    if [[ "$FIRST_ENTRY" == */ ]]; then
      log "Первый элемент в архиве - директория, будем удалять первый уровень каталогов"
      STRIP_COMPONENTS=1
    elif [[ "$FIRST_ENTRY" == */* ]]; then
      # Проверяем, если все файлы имеют одинаковый первый каталог
      PREFIX=$(echo "$FIRST_ENTRY" | cut -d'/' -f1)
      ALL_MATCH=$(grep -v "^$PREFIX/" "$TEMP_DIR/tar_file_list.txt" | wc -l)
      
      if [ $ALL_MATCH -eq 0 ]; then
        log "Все файлы имеют общий префикс '$PREFIX', будем удалять первый уровень каталогов"
        STRIP_COMPONENTS=1
      fi
    fi
    
    # Распаковка tar-архива
    if [ $STRIP_COMPONENTS -eq 1 ]; then
      log "Распаковка tar с удалением первого уровня каталогов..."
      tar --strip-components=1 -xf "$TAR_FILE" -C "$RESTORE_DIR"
    else
      log "Распаковка tar без удаления первого уровня каталогов..."
      tar -xf "$TAR_FILE" -C "$RESTORE_DIR"
    fi
    
    # Проверяем результат
    if [ $? -eq 0 ]; then
      log "Распаковка методом 2 успешно завершена"
      SUCCESS=1
    else
      log "Ошибка при распаковке архива методом 2"
    fi
  else
    log "Не удалось распаковать gzip архив"
  fi
fi

# МЕТОД 3: 7z для распаковки (если доступен)
if [ $SUCCESS -eq 0 ] && command -v 7z > /dev/null; then
  log "Метод 3: Распаковка с помощью 7z..."
  
  # Распаковываем во временную директорию для анализа
  EXTRACT_DIR="$TEMP_DIR/extract"
  mkdir -p "$EXTRACT_DIR"
  
  7z x "${BACKUP_PATH}" -o"$EXTRACT_DIR" -y
  if [ $? -eq 0 ]; then
    log "Архив успешно распакован с помощью 7z, анализируем структуру..."
    
    # Проверяем, если в корне только одна директория
    DIRS=$(find "$EXTRACT_DIR" -maxdepth 1 -type d | wc -l)
    
    if [ $DIRS -eq 2 ]; then  # 2 потому что учитывается и сам EXTRACT_DIR
      # Есть только одна подпапка
      SUBDIR=$(find "$EXTRACT_DIR" -maxdepth 1 -type d -not -path "$EXTRACT_DIR" | head -1)
      
      if [ -n "$SUBDIR" ]; then
        log "Найдена одна подпапка: $SUBDIR. Копируем содержимое..."
        cp -R "$SUBDIR"/* "$RESTORE_DIR"/ 2>/dev/null || true
        SUCCESS=1
      else
        log "Странно, директория не найдена"
      fi
    else
      # Копируем все содержимое
      log "Найдено несколько файлов/директорий в корне, копируем всё..."
      cp -R "$EXTRACT_DIR"/* "$RESTORE_DIR"/ 2>/dev/null || true
      SUCCESS=1
    fi
  else
    log "Ошибка при распаковке архива с помощью 7z"
  fi
fi

# Проверка содержимого результата
log "Содержимое целевой директории после распаковки:"
ls -la "$RESTORE_DIR" | tee -a "$LOG_FILE"

# Проверяем, есть ли подпапка с UUID в целевой директории
UUID_DIR="$RESTORE_DIR/$DISK_UUID"
if [ -d "$UUID_DIR" ]; then
  log "Найдена подпапка с UUID: $UUID_DIR"
  log "Перемещаем содержимое в корневую директорию..."
  
  # Перемещаем содержимое подпапки в корень
  mv "$UUID_DIR"/* "$RESTORE_DIR"/ 2>/dev/null || true
  rmdir "$UUID_DIR" 2>/dev/null || true
  
  log "Содержимое целевой директории после перемещения:"
  ls -la "$RESTORE_DIR" | tee -a "$LOG_FILE"
fi

# Итоговая проверка успешности
if [ $SUCCESS -eq 1 ]; then
  log "Восстановление успешно завершено"
  
  # Устанавливаем правильные права доступа
  log "Установка прав доступа..."
  chown -R user:user "$RESTORE_DIR" 2>/dev/null || chown -R 1000:1000 "$RESTORE_DIR" 2>/dev/null || true
  chmod -R 755 "$RESTORE_DIR" 2>/dev/null || true
  
  # Записываем статус
  echo "SUCCESS" > "$STATUS_FILE"
  log "Готово! Бэкап успешно восстановлен."
  exit 0
else
  log "ОШИБКА: Не удалось распаковать архив ни одним из методов"
  log "Дополнительная информация о файле:"
  file -z "${BACKUP_PATH}" | tee -a "$LOG_FILE"
  
  # Записываем статус ошибки
  echo "ERROR" > "$STATUS_FILE"
  exit 1
fi 