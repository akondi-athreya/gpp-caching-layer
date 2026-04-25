const net = require('net');
const config = require('../config');
const { getCacheClients } = require('../cacheFactory');

const WINDOW_SECONDS = 60;
const REDIS_RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

function getUserId(req) {
	const headerUserId = req.header('X-User-Id');
	if (headerUserId && String(headerUserId).trim()) {
		return String(headerUserId).trim();
	}

	const forwardedFor = req.header('X-Forwarded-For');
	if (forwardedFor && String(forwardedFor).trim()) {
		return String(forwardedFor).split(',')[0].trim();
	}

	return req.ip || 'unknown';
}

function rateLimitKey(userId) {
	const epochMinute = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
	return `ratelimit:${userId}:${epochMinute}`;
}

function parseMemcachedTarget() {
	const firstTarget = String(config.memcachedUrl || '').split(',')[0].trim();
	const [host, portRaw] = firstTarget.split(':');
	const port = Number(portRaw || 11211);

	if (!host || !Number.isInteger(port) || port <= 0) {
		throw new Error(`Invalid MEMCACHED_URL: ${config.memcachedUrl}`);
	}

	return { host, port };
}

function sendMemcachedTextCommand(command) {
	const target = parseMemcachedTarget();

	return new Promise((resolve, reject) => {
		let settled = false;
		let buffer = '';

		const socket = net.createConnection({ host: target.host, port: target.port }, () => {
			socket.write(`${command}\r\n`);
		});

		socket.setTimeout(1500);

		socket.on('data', (chunk) => {
			buffer += chunk.toString('utf8');
			if (buffer.includes('\r\n')) {
				settled = true;
				socket.destroy();
				resolve(buffer.split('\r\n')[0]);
			}
		});

		socket.on('timeout', () => {
			if (!settled) {
				settled = true;
				socket.destroy();
				reject(new Error('Memcached text command timed out'));
			}
		});

		socket.on('error', (error) => {
			if (!settled) {
				settled = true;
				reject(error);
			}
		});

		socket.on('close', () => {
			if (!settled) {
				settled = true;
				reject(new Error('Memcached connection closed before response'));
			}
		});
	});
}

async function incrementMemcachedRateKey(key) {
	const incrResponse = await sendMemcachedTextCommand(`incr ${key} 1`);
	if (incrResponse !== 'NOT_FOUND') {
		return Number(incrResponse);
	}

	const addResponse = await sendMemcachedTextCommand(`add ${key} 0 ${WINDOW_SECONDS + 5} 1\r\n1`);
	if (addResponse === 'STORED') {
		return 1;
	}

	const retryResponse = await sendMemcachedTextCommand(`incr ${key} 1`);
	if (retryResponse === 'NOT_FOUND') {
		throw new Error('Memcached rate-limit key disappeared during increment');
	}
	return Number(retryResponse);
}

async function applyRedisRateLimit(userId) {
	const { redis } = await getCacheClients();
	const key = rateLimitKey(userId);
	const [count, ttl] = await redis.eval(REDIS_RATE_LIMIT_LUA, {
		keys: [key],
		arguments: [String(WINDOW_SECONDS)],
	});

	return {
		count: Number(count),
		ttlSeconds: Number(ttl),
	};
}

async function applyMemcachedRateLimit(userId) {
	const key = rateLimitKey(userId);
	const count = await incrementMemcachedRateKey(key);

	return {
		count,
		ttlSeconds: WINDOW_SECONDS,
	};
}

async function applyRateLimit(userId, backend) {
	if (backend === 'redis') {
		return applyRedisRateLimit(userId);
	}

	if (backend === 'memcached') {
		return applyMemcachedRateLimit(userId);
	}

	throw new Error(`Unsupported cache backend: ${backend}`);
}

module.exports = {
	WINDOW_SECONDS,
	getUserId,
	applyRateLimit,
};
