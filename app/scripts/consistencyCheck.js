const leaderboardService = require('../src/services/leaderboardService');
const rateLimitService = require('../src/services/rateLimitService');
const { getCacheClients } = require('../src/cacheFactory');
const {
	memcachedSet,
	memcachedDelete,
} = require('../src/memcachedAdapter');

const PRODUCT_ID = 4242;
const WORKERS = 10;
const INCREMENTS_PER_WORKER = 100;
const USER_ID = 'consistency-user';
const RATE_LIMIT_LIMIT = 100;
const RATE_LIMIT_REQUESTS = 105;

function rateLimitKey(userId) {
	const epochMinute = Math.floor(Date.now() / (60 * 1000));
	return `ratelimit:${userId}:${epochMinute}`;
}

async function resetLeaderboardState() {
	const { redis, memcached } = await getCacheClients();

	await redis.del('leaderboard:views');

	await memcachedSet(memcached, 'leaderboard:views:json', '{}');
	try {
		await memcachedDelete(memcached, 'lock:leaderboard:views');
	} catch (e) {
		// Ignore if delete fails (e.g. key not found)
	}
}

async function resetRateLimitState() {
	const { redis, memcached } = await getCacheClients();
	const key = rateLimitKey(USER_ID);

	await redis.del(key);

	try {
		await memcachedDelete(memcached, key);
	} catch (e) {
		// Ignore
	}
}

async function runConcurrentIncrements(backend, useLock) {
	const tasks = [];

	for (let i = 0; i < WORKERS; i += 1) {
		tasks.push((async () => {
			for (let j = 0; j < INCREMENTS_PER_WORKER; j += 1) {
				if (backend === 'redis') {
					await leaderboardService.incrementView(PRODUCT_ID, backend);
				} else {
					await leaderboardService.incrementView(PRODUCT_ID, backend, { useLock });
				}
			}
		})());
	}

	await Promise.all(tasks);
}

async function getScore(backend) {
	const board = await leaderboardService.getLeaderboard(backend, 100);
	const row = board.find((item) => Number(item.productId) === PRODUCT_ID);
	return row ? Number(row.score) : 0;
}

async function runRateLimitBurst(backend) {
	const calls = Array.from({ length: RATE_LIMIT_REQUESTS }, () => rateLimitService.applyRateLimit(USER_ID, backend));
	const states = await Promise.all(calls);
	return {
		allowed: states.filter((state) => state.count <= RATE_LIMIT_LIMIT).length,
		blocked: states.filter((state) => state.count > RATE_LIMIT_LIMIT).length,
		finalCount: Math.max(...states.map((state) => state.count)),
	};
}

async function main() {
	const expected = WORKERS * INCREMENTS_PER_WORKER;

	await resetLeaderboardState();
	await runConcurrentIncrements('redis');
	const redisScore = await getScore('redis');

	await resetLeaderboardState();
	await runConcurrentIncrements('memcached', false);
	const memNoLockScore = await getScore('memcached');

	await resetLeaderboardState();
	await runConcurrentIncrements('memcached', true);
	const memWithLockScore = await getScore('memcached');

	await resetRateLimitState();
	const redisRateLimit = await runRateLimitBurst('redis');

	await resetRateLimitState();
	const memcachedRateLimit = await runRateLimitBurst('memcached');

	const output = {
		expected,
		redis: {
			finalScore: redisScore,
			lostIncrements: expected - redisScore,
		},
		memcached: {
			noLock: {
				finalScore: memNoLockScore,
				lostIncrements: expected - memNoLockScore,
			},
			withLock: {
				finalScore: memWithLockScore,
				lostIncrements: expected - memWithLockScore,
			},
		},
		rateLimit: {
			redis: redisRateLimit,
			memcached: memcachedRateLimit,
		},
	};

	console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
	console.error('Consistency check failed:', error);
	process.exit(1);
});
