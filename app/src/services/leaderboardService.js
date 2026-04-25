const { getCacheClients } = require('../cacheFactory');
const { getMemcachedClient } = require('../memcachedClient');
const {
	memcachedGet,
	memcachedSet,
	memcachedAdd,
	memcachedDelete,
} = require('../memcachedAdapter');

const REDIS_LEADERBOARD_KEY = 'leaderboard:views';
const MEM_LEADERBOARD_KEY = 'leaderboard:views:json';
const MEM_LEADERBOARD_LOCK_KEY = 'lock:leaderboard:views';

const LOCK_RETRY_COUNT = 30;
const LOCK_BASE_DELAY_MS = 2;
const LOCK_MAX_DELAY_MS = 64;

function createError(statusCode, message) {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

function parseProductId(id) {
	const parsed = Number(id);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw createError(400, 'Product id must be a positive integer');
	}
	return parsed;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadMemcachedBoard(client) {
	const cached = await memcachedGet(client, MEM_LEADERBOARD_KEY);
	if (!cached) {
		return {};
	}
	const str = cached.toString().trim();
	if (!str) {
		console.warn('Memcached leaderboard key found but content is empty');
		return {};
	}
	try {
		return JSON.parse(str);
	} catch (e) {
		console.error('Failed to parse Memcached leaderboard JSON:', str);
		return {};
	}
}

function topNFromBoard(board, limit) {
	return Object.entries(board)
		.map(([productId, score]) => ({ productId, score: Number(score) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}

async function incrementViewRedis(redisClient, productId) {
	const score = await redisClient.zIncrBy(REDIS_LEADERBOARD_KEY, 1, String(productId));
	return Number(score);
}

async function incrementViewMemcachedNoLock(memcachedClient, productId) {
	const board = await loadMemcachedBoard(memcachedClient);
	const key = String(productId);
	board[key] = Number(board[key] || 0) + 1;
	const data = JSON.stringify(board);
	await memcachedSet(memcachedClient, MEM_LEADERBOARD_KEY, data);
	return board[key];
}

async function acquireMemcachedLock(memcachedClient, token) {
	for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
		const acquired = await memcachedAdd(memcachedClient, MEM_LEADERBOARD_LOCK_KEY, token);
		if (acquired) {
			return true;
		}

		const delay = Math.min(LOCK_MAX_DELAY_MS, LOCK_BASE_DELAY_MS * Math.pow(2, attempt));
		await sleep(delay);
	}

	return false;
}

async function incrementViewMemcachedLocked(boardClient, lockClient, productId) {
	const lockToken = `lock-${Date.now()}-${Math.random()}`;
	const acquired = await acquireMemcachedLock(lockClient, lockToken);
	if (!acquired) {
		throw createError(503, 'Failed to acquire leaderboard lock');
	}

	try {
		const board = await loadMemcachedBoard(boardClient);
		const key = String(productId);
		board[key] = Number(board[key] || 0) + 1;
		const data = JSON.stringify(board);
		await memcachedSet(boardClient, MEM_LEADERBOARD_KEY, data);
		return board[key];
	} finally {
		await memcachedDelete(lockClient, MEM_LEADERBOARD_LOCK_KEY);
	}
}

async function incrementView(productIdInput, backend, options = {}) {
	const productId = parseProductId(productIdInput);
	const { redis, memcached } = await getCacheClients();

	if (backend === 'redis') {
		return incrementViewRedis(redis, productId);
	}

	if (backend === 'memcached') {
		const lockClient = getMemcachedClient(5);
		if (options.useLock === false) {
			return incrementViewMemcachedNoLock(memcached, productId);
		}
		return incrementViewMemcachedLocked(memcached, lockClient, productId);
	}

	throw createError(400, `Unsupported cache backend: ${backend}`);
}

async function getLeaderboard(backend, limit = 10) {
	const { redis, memcached } = await getCacheClients();

	if (backend === 'redis') {
		const rows = await redis.zRangeWithScores(REDIS_LEADERBOARD_KEY, 0, limit - 1, { REV: true });
		return rows.map((row) => ({ productId: row.value, score: Number(row.score) }));
	}

	if (backend === 'memcached') {
		const board = await loadMemcachedBoard(memcached);
		return topNFromBoard(board, limit);
	}

	throw createError(400, `Unsupported cache backend: ${backend}`);
}

module.exports = {
	getLeaderboard,
	incrementView,
	incrementViewMemcachedNoLock,
};
