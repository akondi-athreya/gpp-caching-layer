
const memjs = require('memjs');
const config = require('./config');

let memcachedClient = null;
const memcachedClients = new Map();

function getMemcachedClient(expiresSeconds = 0) {
    const cacheKey = String(Number(expiresSeconds) || 0);
    if (!memcachedClients.has(cacheKey)) {
        memcachedClients.set(cacheKey, memjs.Client.create(config.memcachedUrl, {
            expires: Number(expiresSeconds) || 0,
        }));
        if (!memcachedClient) {
            memcachedClient = memcachedClients.get(cacheKey);
        }
        console.log(`Connected to Memcached (expires=${cacheKey})`);
    }
    return memcachedClients.get(cacheKey);
}

module.exports = {
    getMemcachedClient
};