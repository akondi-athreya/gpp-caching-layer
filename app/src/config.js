const dotenv = require('dotenv');
dotenv.config();

const validBackends = ['redis', 'memcached'];
const config = {
    apiPort: process.env.API_PORT || 3000,
    defaultCacheBackend: process.env.DEFAULT_CACHE_BACKEND,
    cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300,
    rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE, 10) || 100,
    redisUrl: process.env.REDIS_URL,
    memcachedUrl: process.env.MEMCACHED_URL,
    databaseUrl: process.env.DATABASE_URL
};

// Validate required variables
if (!config.defaultCacheBackend) {
    throw new Error('DEFAULT_CACHE_BACKEND is required');
}
if (!validBackends.includes(config.defaultCacheBackend)) {
    throw new Error(`DEFAULT_CACHE_BACKEND must be one of: ${validBackends.join(', ')}`);
}
if (!config.redisUrl) {
    throw new Error('REDIS_URL is required');
}
if (!config.memcachedUrl) {
    throw new Error('MEMCACHED_URL is required');
}
if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
}

module.exports = config;