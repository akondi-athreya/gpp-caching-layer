
const redis = require('redis');
const config = require('./config');

let redisClient = null;

async function connectRedis() {
    if (!redisClient) {
        redisClient = redis.createClient({
            url: config.redisUrl
        });

        redisClient.on('error', (err) => {
            console.error('Redis Client Error', err);
        });

        await redisClient.connect();
        console.log('Connected to Redis');
    }
    return redisClient;
}

function getRedisClient() {
    if (!redisClient) {
        throw new Error('Redis client not connected. Call connectRedis() first.');
    }
    return redisClient;
}

module.exports = {
    connectRedis,
    getRedisClient
};