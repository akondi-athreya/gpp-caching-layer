const config = require('../config');
const { getUserId, applyRateLimit } = require('../services/rateLimitService');

async function rateLimiter(req, res, next) {
	try {
		const userId = getUserId(req);
		const backend = req.cacheBackend;
		const limit = config.rateLimitPerMinute;

		const state = await applyRateLimit(userId, backend);

		res.setHeader('X-RateLimit-Limit', String(limit));
		res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - state.count)));
		res.setHeader('X-RateLimit-Reset-Seconds', String(Math.max(0, state.ttlSeconds)));

		if (state.count > limit) {
			return res.status(429).json({
				error: 'Rate limit exceeded',
				userId,
				cacheBackend: backend,
				limit,
				currentCount: state.count,
			});
		}

		return next();
	} catch (error) {
		return res.status(500).json({
			error: 'Rate limiter failure',
			detail: error.message,
		});
	}
}

module.exports = rateLimiter;
