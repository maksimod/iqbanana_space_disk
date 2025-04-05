const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://127.0.0.1:6005',
      changeOrigin: true,
      pathRewrite: {
        '^/api': '/api', // no rewrite needed
      },
      onProxyReq: (proxyReq, req, res) => {
        // Log the proxy request for debugging
        console.log('Proxying:', req.method, req.path, 'to', 'http://127.0.0.1:6005' + req.path);
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err);
        res.writeHead(500, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ 
          message: 'Proxy error: Could not connect to backend API.',
          error: err.message
        }));
      }
    })
  );
}; 