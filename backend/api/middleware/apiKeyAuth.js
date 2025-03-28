const dotenv = require('dotenv');
const path = require('path');
const logger = require('../../utils/logger');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * API Key Authentication Middleware
 * Validates the API key from the request header or query parameter
 */
const apiKeyAuth = (req, res, next) => {
  try {
    // Get API key from header or query parameter
    const apiKeyHeader = req.headers['x-api-key'];
    const apiKeyQuery = req.query.api_key;
    const apiKey = apiKeyHeader || apiKeyQuery;
    
    // Check if API key exists
    if (!apiKey) {
      logger.error('API authentication failed: Missing API key');
      return res.status(401).json({
        success: false,
        error: 'API key is required'
      });
    }
    
    // Validate API key
    if (apiKey !== process.env.API_KEY) {
      logger.error(`API authentication failed: Invalid API key [${apiKey.slice(0, 6)}...]`);
      return res.status(403).json({
        success: false,
        error: 'Invalid API key'
      });
    }
    
    logger.info('API authentication successful');
    next();
  } catch (error) {
    logger.error(`API authentication error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during authentication'
    });
  }
};

module.exports = apiKeyAuth; 