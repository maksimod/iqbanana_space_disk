#!/usr/bin/env node

/**
 * Скрипт для обновления конфигурации бэкапов
 * Создает/обновляет переменную backup_disks в backend/config/config.js
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Пути к файлам
const CONFIG_FILE = path.resolve(__dirname, '../backend/config/config.js');
const BACKUP_CONFIG_SH_FILE = path.resolve(__dirname, './backup_config.sh');

// Логгирование
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Функция для чтения переменных из файла backup_config.sh
function readBackupConfigVariables() {
  try {
    if (!fs.existsSync(BACKUP_CONFIG_SH_FILE)) {
      log(`Файл конфигурации не найден: ${BACKUP_CONFIG_SH_FILE}`);
      return null;
    }

    const config = fs.readFileSync(BACKUP_CONFIG_SH_FILE, 'utf8');
    
    // Получаем SOURCE_UUID - UUID диска, который нужно бэкапить
    const sourceUuidMatch = config.match(/SOURCE_UUID=["']?([a-fA-F0-9-]+)["']?/);
    const sourceUuid = sourceUuidMatch ? sourceUuidMatch[1].trim() : null;
    
    // Получаем TARGET_UUID - UUID диска, на который нужно сохранять бэкапы
    const targetUuidMatch = config.match(/TARGET_UUID=["']?([a-fA-F0-9-]+)["']?/);
    const targetUuid = targetUuidMatch ? targetUuidMatch[1].trim() : null;
    
    if (!sourceUuid || !targetUuid) {
      log('Не найдены SOURCE_UUID или TARGET_UUID в файле конфигурации');
      return null;
    }
    
    log(`Получены UUID из конфигурации: SOURCE_UUID=${sourceUuid}, TARGET_UUID=${targetUuid}`);
    
    return { sourceUuid, targetUuid };
  } catch (error) {
    log(`Ошибка при чтении конфигурации: ${error.message}`);
    return null;
  }
}

// Функция для получения имени диска по UUID из конфигурации
function getDiskNameByUuid(configContent, targetUuid) {
  try {
    // Ищем секцию disks в конфигурации
    const disksMatch = configContent.match(/disks\s*:\s*{([^}]*)}/s);
    if (!disksMatch || !disksMatch[1]) {
      log('Не найдена секция disks в конфигурации');
      return null;
    }
    
    const disksSection = disksMatch[1].trim();
    
    // Ищем путь содержащий указанный UUID
    const diskRegex = /"([^"]+)"\s*:\s*"([^"]*)"/g;
    let match;
    let foundDiskName = null;
    
    while ((match = diskRegex.exec(disksSection)) !== null) {
      const diskName = match[1];
      const diskPath = match[2];
      
      // Проверяем, содержит ли путь указанный UUID
      if (diskPath.includes(targetUuid)) {
        log(`Найден диск ${diskName} для UUID ${targetUuid}`);
        foundDiskName = diskName;
        break;
      }
    }
    
    return foundDiskName;
  } catch (error) {
    log(`Ошибка при поиске имени диска по UUID: ${error.message}`);
    return null;
  }
}

// Обновление конфигурации бэкенда
async function updateBackendConfig() {
  try {
    // Читаем переменные из файла конфигурации
    const configVars = readBackupConfigVariables();
    if (!configVars) {
      log('Не удалось получить переменные из файла конфигурации');
      return false;
    }
    
    const { sourceUuid, targetUuid } = configVars;
    
    // Проверяем наличие файла конфигурации бэкенда
    if (!fs.existsSync(CONFIG_FILE)) {
      log(`Файл конфигурации бэкенда не найден: ${CONFIG_FILE}`);
      return false;
    }
    
    // Читаем содержимое конфигурации бэкенда
    const configContent = fs.readFileSync(CONFIG_FILE, 'utf8');
    
    // Ищем имя диска для source и target
    const sourceDiskName = getDiskNameByUuid(configContent, sourceUuid);
    
    if (!sourceDiskName) {
      log(`Не найдено имя диска для UUID ${sourceUuid}`);
      return false;
    }
    
    log(`Найдено имя диска для SOURCE_UUID: ${sourceDiskName}`);
    
    // Создаем карту backup_disks
    const backupDisksMap = {
      [sourceDiskName]: targetUuid
    };
    
    log(`Создана карта backup_disks: ${JSON.stringify(backupDisksMap)}`);
    
    // Проверяем, есть ли уже переменная backup_disks в конфигурации
    const backupDisksRegex = /backup_disks\s*:\s*{[^}]*}/;
    const backupDisksString = `backup_disks: ${JSON.stringify(backupDisksMap, null, 2)}`;
    
    let updatedContent;
    
    if (backupDisksRegex.test(configContent)) {
      // Обновляем существующую переменную
      updatedContent = configContent.replace(backupDisksRegex, backupDisksString);
      log('Обновлена существующая переменная backup_disks в конфигурации');
    } else {
      // Добавляем новую переменную
      // Ищем объект backup, чтобы добавить нашу переменную после него
      const backupMatch = configContent.match(/backup\s*:\s*{[^}]*}/);
      
      if (backupMatch) {
        const backupIndex = configContent.indexOf(backupMatch[0]) + backupMatch[0].length;
        updatedContent = configContent.slice(0, backupIndex) + ',\n\n  // Соответствие имен дисков и UUID для бэкапов\n  ' + backupDisksString + configContent.slice(backupIndex);
        log('Добавлена новая переменная backup_disks после секции backup');
      } else {
        // Если не нашли секцию backup, добавляем перед exports
        const exportMatch = configContent.match(/module\.exports\s*=\s*config/);
        
        if (exportMatch) {
          const exportIndex = configContent.indexOf(exportMatch[0]);
          updatedContent = configContent.slice(0, exportIndex) + '  // Соответствие имен дисков и UUID для бэкапов\n  ' + backupDisksString + ',\n\n' + configContent.slice(exportIndex);
          log('Добавлена новая переменная backup_disks перед экспортом');
        } else {
          log('Не удалось найти подходящее место для добавления переменной backup_disks');
          return false;
        }
      }
    }
    
    // Записываем обновленную конфигурацию
    fs.writeFileSync(CONFIG_FILE, updatedContent, 'utf8');
    log(`Конфигурация успешно обновлена: ${CONFIG_FILE}`);
    
    return true;
  } catch (error) {
    log(`Ошибка при обновлении конфигурации: ${error.message}`);
    return false;
  }
}

// Главная функция
async function main() {
  try {
    log('Запуск обновления конфигурации бэкапов...');
    
    // Обновляем конфигурацию
    const updated = await updateBackendConfig();
    
    if (updated) {
      log('Конфигурация бэкапов успешно обновлена');
      process.exit(0);
    } else {
      log('Не удалось обновить конфигурацию бэкапов');
      process.exit(1);
    }
  } catch (error) {
    log(`Необработанная ошибка: ${error.message}`);
    process.exit(1);
  }
}

// Запуск скрипта
main();