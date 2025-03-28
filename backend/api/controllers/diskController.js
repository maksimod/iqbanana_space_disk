const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const config = require('../../config/config');
const logger = require('../../utils/logger');

const execPromise = util.promisify(exec);
const fsPromises = fs.promises;

/**
 * Get list of all available disks
 */
const getDisks = async (req, res) => {
  try {
    logger.info('API request: Get disks list');
    
    const disks = Object.entries(config.disks).map(([name, mountPoint]) => {
      const isMounted = global.mountedDisks[name] === true;
      
      return {
        name,
        mountPoint,
        status: isMounted ? 'online' : 'offline'
      };
    });
    
    return res.json({
      success: true,
      data: disks
    });
  } catch (error) {
    logger.error('Error getting disks list:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to get disks list: ${error.message}`
    });
  }
};

/**
 * Rename a disk in the configuration
 */
const renameDisk = async (req, res) => {
  try {
    const { diskId, newName } = req.body;
    
    if (!diskId || !newName) {
      return res.status(400).json({
        success: false,
        error: 'Disk ID and new name are required'
      });
    }
    
    if (!config.disks[diskId]) {
      return res.status(404).json({
        success: false,
        error: `Disk '${diskId}' not found`
      });
    }
    
    // Check if the new name already exists
    if (config.disks[newName] && diskId !== newName) {
      return res.status(409).json({
        success: false,
        error: `Disk with name '${newName}' already exists`
      });
    }
    
    logger.info(`API request: Rename disk '${diskId}' to '${newName}'`);
    
    // Get the mount point
    const mountPoint = config.disks[diskId];
    
    // Update the config file
    const configPath = path.join(__dirname, '../../config/config.js');
    let configContent = await fsPromises.readFile(configPath, 'utf8');
    
    // Create a backup of the config file
    const backupPath = `${configPath}.backup.${Math.floor(Date.now() / 1000)}`;
    await fsPromises.writeFile(backupPath, configContent);
    
    // Update the content with the new disk name
    configContent = configContent.replace(
      new RegExp(`'${diskId}'\\s*:\\s*'${mountPoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
      `'${newName}': '${mountPoint}'`
    );
    
    // Write the updated config back
    await fsPromises.writeFile(configPath, configContent);
    
    // Update the global config and mountedDisks
    config.disks[newName] = mountPoint;
    global.mountedDisks[newName] = global.mountedDisks[diskId];
    
    // Remove old disk entries
    if (diskId !== newName) {
      delete config.disks[diskId];
      delete global.mountedDisks[diskId];
    }
    
    return res.json({
      success: true,
      message: `Disk '${diskId}' renamed to '${newName}'`,
      data: {
        name: newName,
        mountPoint,
        status: global.mountedDisks[newName] ? 'online' : 'offline'
      }
    });
  } catch (error) {
    logger.error('Error renaming disk:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to rename disk: ${error.message}`
    });
  }
};

/**
 * Rename multiple disks at once
 */
const renameBulkDisks = async (req, res) => {
  try {
    const { disks } = req.body;
    
    if (!Array.isArray(disks) || disks.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'A valid array of disks is required'
      });
    }
    
    logger.info(`API request: Bulk rename ${disks.length} disks`);
    
    // Validate all entries first
    for (const { diskId, newName } of disks) {
      if (!diskId || !newName) {
        return res.status(400).json({
          success: false,
          error: 'Disk ID and new name are required for all entries'
        });
      }
      
      if (!config.disks[diskId]) {
        return res.status(404).json({
          success: false,
          error: `Disk '${diskId}' not found`
        });
      }
    }
    
    // Check for duplicate new names
    const newNames = disks.map(d => d.newName);
    if (new Set(newNames).size !== newNames.length) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate new names detected'
      });
    }
    
    // Create a backup of the config file
    const configPath = path.join(__dirname, '../../config/config.js');
    let configContent = await fsPromises.readFile(configPath, 'utf8');
    const backupPath = `${configPath}.backup.${Math.floor(Date.now() / 1000)}`;
    await fsPromises.writeFile(backupPath, configContent);
    
    // Perform renames
    const results = [];
    
    for (const { diskId, newName } of disks) {
      const mountPoint = config.disks[diskId];
      
      // Update the content with the new disk name
      configContent = configContent.replace(
        new RegExp(`'${diskId}'\\s*:\\s*'${mountPoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
        `'${newName}': '${mountPoint}'`
      );
      
      // Update the global config and mountedDisks
      config.disks[newName] = mountPoint;
      global.mountedDisks[newName] = global.mountedDisks[diskId];
      
      // Remove old disk entries if different
      if (diskId !== newName) {
        delete config.disks[diskId];
        delete global.mountedDisks[diskId];
      }
      
      results.push({
        oldName: diskId,
        newName,
        mountPoint,
        status: global.mountedDisks[newName] ? 'online' : 'offline'
      });
    }
    
    // Write the updated config back
    await fsPromises.writeFile(configPath, configContent);
    
    return res.json({
      success: true,
      message: `${results.length} disks renamed successfully`,
      data: results
    });
  } catch (error) {
    logger.error('Error in bulk disk rename:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to rename disks: ${error.message}`
    });
  }
};

module.exports = {
  getDisks,
  renameDisk,
  renameBulkDisks
}; 