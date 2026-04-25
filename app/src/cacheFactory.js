
const redisClient = require('./redisClient');
const memcachedClient = require('./memcachedClient');

async function getCacheClients() {
    const redis = await redisClient.connectRedis();
    const memcached = memcachedClient.getMemcachedClient(0);

    return {
        redis,
        memcached
    };
}

module.exports = { getCacheClients };