const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');
const util = require('util');
const config = require('../../config/config');
const logger = require('../../utils/logger');

const execPromise = util.promisify(exec);
const fsPromises = fs.promises;

/**
 * Upload a file to the specified disk and path
 * Creates directories if they don't exist
 */
const uploadFile = async (req, res) => {
  try {
    const { diskId } = req.params;
    let { filePath } = req.body;
    
    if (!diskId) {
      return res.status(400).json({
        success: false,
        error: 'Disk ID is required'
      });
    }
    
    if (!config.disks[diskId]) {
      return res.status(404).json({
        success: false,
        error: `Disk '${diskId}' not found`
      });
    }
    
    if (!global.mountedDisks[diskId]) {
      return res.status(400).json({
        success: false,
        error: `Disk '${diskId}' is not mounted or unavailable`
      });
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file was uploaded'
      });
    }
    
    // Get the disk mount point
    const mountPoint = config.disks[diskId];
    
    // Normalize the target file path
    filePath = filePath || '';
    
    // Remove any starting slashes
    filePath = filePath.replace(/^\/*/, '');
    
    // Create the full target path
    const fullDirPath = path.join(mountPoint, path.dirname(filePath));
    const fullFilePath = path.join(mountPoint, filePath);
    
    logger.info(`API request: Upload file to '${diskId}:${filePath}'`);
    
    // Create the directory structure if it doesn't exist
    await fsPromises.mkdir(fullDirPath, { recursive: true });
    
    // Instead of rename (which fails across devices), use copy + delete
    // Create a read stream from the temp file
    const readStream = fs.createReadStream(req.file.path);
    // Create a write stream to the target file
    const writeStream = fs.createWriteStream(fullFilePath);
    
    // Return a promise that resolves when the copy is complete
    await new Promise((resolve, reject) => {
      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      readStream.pipe(writeStream);
    });
    
    // Delete the temp file
    await fsPromises.unlink(req.file.path);
    
    return res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        disk: diskId,
        path: filePath,
        size: req.file.size,
        name: path.basename(filePath)
      }
    });
  } catch (error) {
    // Cleanup the temporary file if it exists
    if (req.file && req.file.path) {
      try {
        await fsPromises.unlink(req.file.path);
      } catch (unlinkError) {
        logger.error('Error cleaning up temporary file:', unlinkError);
      }
    }
    
    logger.error('Error uploading file:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to upload file: ${error.message}`
    });
  }
};

/**
 * Download a file from the specified disk and path
 */
const downloadFile = async (req, res) => {
  try {
    const { diskId } = req.params;
    const { filePath } = req.query;
    
    if (!diskId) {
      return res.status(400).json({
        success: false,
        error: 'Disk ID is required'
      });
    }
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'File path is required'
      });
    }
    
    if (!config.disks[diskId]) {
      return res.status(404).json({
        success: false,
        error: `Disk '${diskId}' not found`
      });
    }
    
    if (!global.mountedDisks[diskId]) {
      return res.status(400).json({
        success: false,
        error: `Disk '${diskId}' is not mounted or unavailable`
      });
    }
    
    // Get the disk mount point
    const mountPoint = config.disks[diskId];
    
    // Normalize the file path
    const normalizedPath = filePath.replace(/^\/*/, '');
    const fullFilePath = path.join(mountPoint, normalizedPath);
    
    logger.info(`API request: Download file from '${diskId}:${normalizedPath}'`);
    
    // Check if file exists
    const fileStats = await fsPromises.stat(fullFilePath);
    
    if (!fileStats.isFile()) {
      return res.status(400).json({
        success: false,
        error: 'The specified path is not a file'
      });
    }
    
    // Set response headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(normalizedPath)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fileStats.size);
    
    // Stream the file to the response
    const fileStream = fs.createReadStream(fullFilePath);
    fileStream.pipe(res);
    
    // Handle errors during streaming
    fileStream.on('error', (error) => {
      logger.error(`Error streaming file ${fullFilePath}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: `Failed to stream file: ${error.message}`
        });
      } else {
        res.end();
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    logger.error('Error downloading file:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to download file: ${error.message}`
    });
  }
};

/**
 * Search for files/folders by name or regex pattern
 */
const searchFiles = async (req, res) => {
  try {
    const { diskId } = req.params;
    const { pattern, isRegex, type } = req.query;
    
    if (!diskId) {
      return res.status(400).json({
        success: false,
        error: 'Disk ID is required'
      });
    }
    
    if (!pattern) {
      return res.status(400).json({
        success: false,
        error: 'Search pattern is required'
      });
    }
    
    if (!config.disks[diskId]) {
      return res.status(404).json({
        success: false,
        error: `Disk '${diskId}' not found`
      });
    }
    
    if (!global.mountedDisks[diskId]) {
      return res.status(400).json({
        success: false,
        error: `Disk '${diskId}' is not mounted or unavailable`
      });
    }
    
    const mountPoint = config.disks[diskId];
    
    logger.info(`API request: Search files on '${diskId}' with pattern '${pattern}', regex: ${isRegex === 'true'}`);
    
    let command = '';
    
    // Build the search command based on the type (files, directories, or both)
    if (isRegex === 'true') {
      let typeFilter = '';
      if (type === 'files') {
        typeFilter = '-type f';
      } else if (type === 'directories') {
        typeFilter = '-type d';
      }
      
      command = `find "${mountPoint}" ${typeFilter} -regextype posix-extended -regex ".*${pattern}.*" -not -name ".disk_uuid" -not -path "*.tmp_chunks*" -printf "%P\\n" 2>/dev/null`;
    } else {
      let typeFilter = '';
      if (type === 'files') {
        typeFilter = '-type f';
      } else if (type === 'directories') {
        typeFilter = '-type d';
      }
      
      command = `find "${mountPoint}" ${typeFilter} -name "*${pattern}*" -not -name ".disk_uuid" -not -path "*.tmp_chunks*" -printf "%P\\n" 2>/dev/null`;
    }
    
    const { stdout } = await execPromise(command);
    
    const results = stdout
      .split('\n')
      .filter(line => line.trim())
      // Фильтруем служебные файлы
      .filter(line => !line.includes('.tmp_chunks') && line !== '.disk_uuid')
      .map(filePath => ({
        path: filePath,
        name: path.basename(filePath)
      }));
    
    return res.json({
      success: true,
      data: {
        disk: diskId,
        pattern,
        isRegex: isRegex === 'true',
        type: type || 'all',
        results,
        count: results.length
      }
    });
  } catch (error) {
    logger.error('Error searching files:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to search files: ${error.message}`
    });
  }
};

/**
 * Delete files by pattern or specific path
 */
const deleteFiles = async (req, res) => {
  try {
    const { diskId } = req.params;
    const { pattern, isRegex, confirm } = req.body;
    
    if (!diskId) {
      return res.status(400).json({
        success: false,
        error: 'Disk ID is required'
      });
    }
    
    if (!pattern) {
      return res.status(400).json({
        success: false,
        error: 'File pattern or path is required'
      });
    }
    
    if (confirm !== 'true' && confirm !== true) {
      return res.status(400).json({
        success: false,
        error: 'Confirmation is required for delete operations'
      });
    }
    
    if (!config.disks[diskId]) {
      return res.status(404).json({
        success: false,
        error: `Disk '${diskId}' not found`
      });
    }
    
    if (!global.mountedDisks[diskId]) {
      return res.status(400).json({
        success: false,
        error: `Disk '${diskId}' is not mounted or unavailable`
      });
    }
    
    const mountPoint = config.disks[diskId];
    
    logger.info(`API request: Delete files on '${diskId}' with pattern '${pattern}', regex: ${isRegex}`);
    
    let filesToDelete;
    
    if (isRegex) {
      // Use find command with regex pattern
      const { stdout } = await execPromise(
        `find "${mountPoint}" -type f -regextype posix-extended -regex ".*${pattern}.*" -printf "%P\\n" 2>/dev/null`
      );
      
      filesToDelete = stdout.split('\n').filter(line => line.trim());
    } else if (pattern.includes('*') || pattern.includes('?')) {
      // Pattern contains wildcards, use find with glob pattern
      const { stdout } = await execPromise(
        `find "${mountPoint}" -type f -path "${mountPoint}/${pattern}" -printf "%P\\n" 2>/dev/null`
      );
      
      filesToDelete = stdout.split('\n').filter(line => line.trim());
    } else {
      // Specific file path
      const normalizedPath = pattern.replace(/^\/*/, '');
      const fullPath = path.join(mountPoint, normalizedPath);
      
      try {
        const stats = await fsPromises.stat(fullPath);
        if (stats.isFile()) {
          filesToDelete = [normalizedPath];
        } else {
          return res.status(400).json({
            success: false,
            error: 'The specified path is not a file'
          });
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          return res.status(404).json({
            success: false,
            error: 'File not found'
          });
        }
        throw error;
      }
    }
    
    if (filesToDelete.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No files found matching the pattern'
      });
    }
    
    // Delete the files
    const results = [];
    const errors = [];
    
    for (const filePath of filesToDelete) {
      try {
        // Protect system files from deletion
        if (filePath.includes('.tmp_chunks') || filePath === '.disk_uuid') {
          logger.warn(`Попытка удаления системного файла предотвращена: ${filePath}`);
          errors.push({
            path: filePath,
            error: 'Системные файлы не могут быть удалены'
          });
          continue;
        }
        
        const fullPath = path.join(mountPoint, filePath);
        await fsPromises.unlink(fullPath);
        results.push(filePath);
      } catch (error) {
        logger.error(`Error deleting file ${filePath}:`, error);
        errors.push({
          path: filePath,
          error: error.message
        });
      }
    }
    
    return res.json({
      success: true,
      message: `${results.length} files deleted, ${errors.length} errors`,
      data: {
        disk: diskId,
        deleted: results,
        errors,
        totalDeleted: results.length,
        totalErrors: errors.length
      }
    });
  } catch (error) {
    logger.error('Error deleting files:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to delete files: ${error.message}`
    });
  }
};

module.exports = {
  uploadFile,
  downloadFile,
  searchFiles,
  deleteFiles
}; 