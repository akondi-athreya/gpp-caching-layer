const { getCacheClients } = require('../cacheFactory');
const {
	memcachedGet,
	memcachedSet,
} = require('../memcachedAdapter');
const { getMemcachedClient } = require('../memcachedClient');

const SESSION_TTL_SECONDS = 1800;

function createError(statusCode, message) {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

function parseSessionId(id) {
	const normalized = String(id || '').trim();
	if (!normalized) {
		throw createError(400, 'Session id is required');
	}
	return normalized;
}

function validateSessionPatch(payload) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw createError(400, 'Session payload must be a JSON object');
	}

	const entries = Object.entries(payload);
	if (entries.length === 0) {
		throw createError(400, 'Session payload must include at least one field');
	}

	const normalized = {};
	for (const [key, value] of entries) {
		if (!key || typeof key !== 'string') {
			throw createError(400, 'Session field names must be non-empty strings');
		}
		normalized[key] = value;
	}

	return normalized;
}

async function getSessionById(id, backend) {
	const sessionId = parseSessionId(id);
	const key = `session:${sessionId}`;
	const { redis, memcached } = await getCacheClients();

	if (backend === 'redis') {
		const session = await redis.hGetAll(key);
		if (!session || Object.keys(session).length === 0) {
			return null;
		}
		return session;
	}

	if (backend === 'memcached') {
		const cached = await memcachedGet(memcached, key);
		if (!cached) {
			return null;
		}
		return JSON.parse(cached.toString());
	}

	throw createError(400, `Unsupported cache backend: ${backend}`);
}

async function patchSessionById(id, payload, backend) {
	const sessionId = parseSessionId(id);
	const patch = validateSessionPatch(payload);
	const key = `session:${sessionId}`;
	const { redis, memcached } = await getCacheClients();

	if (backend === 'redis') {
		const redisPatch = {};
		for (const [field, value] of Object.entries(patch)) {
			redisPatch[field] = typeof value === 'string' ? value : JSON.stringify(value);
		}

		await redis.hSet(key, redisPatch);
		await redis.expire(key, SESSION_TTL_SECONDS);

		const session = await redis.hGetAll(key);
		return {
			storageType: 'hash',
			session,
		};
	}

	if (backend === 'memcached') {
		const existing = await getSessionById(sessionId, 'memcached');
		const next = {
			...(existing || {}),
			...patch,
		};

		await memcachedSet(getMemcachedClient(SESSION_TTL_SECONDS), key, JSON.stringify(next));

		return {
			storageType: 'json-string',
			session: next,
		};
	}

	throw createError(400, `Unsupported cache backend: ${backend}`);
}

module.exports = {
	getSessionById,
	patchSessionById,
};
