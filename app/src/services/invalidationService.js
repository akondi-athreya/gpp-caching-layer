const CACHE_VERSION_KEY = 'cache:version';
const INVALIDATION_CHANNEL = 'cache:invalidate';

const {
	memcachedGet,
	memcachedSet,
} = require('../memcachedAdapter');
const { getMemcachedClient } = require('../memcachedClient');

function redisProductKey(productId) {
	return `product:${productId}`;
}

function memcachedProductKey(version, productId) {
	return `v${version}:product:${productId}`;
}

async function getMemcachedVersion(memcachedClient) {
	const cached = await memcachedGet(memcachedClient, CACHE_VERSION_KEY);
	if (cached) {
		return cached.toString();
	}

	const initialVersion = String(Date.now());
	await memcachedSet(getMemcachedClient(0), CACHE_VERSION_KEY, initialVersion);
	return initialVersion;
}

async function bumpMemcachedVersion(memcachedClient) {
	const nextVersion = String(Date.now());
	await memcachedSet(getMemcachedClient(0), CACHE_VERSION_KEY, nextVersion);
	return nextVersion;
}

async function invalidateProductCache({ backend, productId, redisClient, memcachedClient }) {
	if (backend === 'redis') {
		const key = redisProductKey(productId);
		await redisClient.del(key);
		await redisClient.publish(INVALIDATION_CHANNEL, JSON.stringify({ key, productId }));
		return { key, channel: INVALIDATION_CHANNEL };
	}

	if (backend === 'memcached') {
		const version = await bumpMemcachedVersion(memcachedClient);
		return { version };
	}

	throw new Error(`Unsupported backend for invalidation: ${backend}`);
}

module.exports = {
	CACHE_VERSION_KEY,
	INVALIDATION_CHANNEL,
	memcachedGet,
	memcachedSet,
	redisProductKey,
	memcachedProductKey,
	getMemcachedVersion,
	bumpMemcachedVersion,
	invalidateProductCache,
};
