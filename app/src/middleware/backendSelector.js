
const config = require('../config');

function backendSelector(req, res, next) {
    const validBackends = ['redis', 'memcached'];
    let selectedBackend = req.header('X-Cache-Backend');

    if (!selectedBackend) {
        selectedBackend = config.defaultCacheBackend;
    }

    if (!validBackends.includes(selectedBackend)) {
        return res.status(400).json({
            error: `Invalid X-Cache-Backend header. Must be one of: ${validBackends.join(', ')}`
        });
    }

    req.cacheBackend = selectedBackend;
    next();
}

module.exports = backendSelector;