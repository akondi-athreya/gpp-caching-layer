const config = require('../config');
const db = require('../db');
const { getCacheClients } = require('../cacheFactory');
const { getMemcachedClient } = require('../memcachedClient');
const {
	memcachedGet,
	memcachedSet,
	redisProductKey,
	memcachedProductKey,
	getMemcachedVersion,
	invalidateProductCache,
} = require('./invalidationService');

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

async function loadFromDb(productId) {
	const result = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
	return result.rows[0] || null;
}

function parseUpdatePayload(payload) {
	const allowedFields = ['name', 'description', 'price', 'currency', 'category', 'stock'];
	const updates = {};

	for (const field of allowedFields) {
		if (Object.prototype.hasOwnProperty.call(payload, field)) {
			updates[field] = payload[field];
		}
	}

	if (Object.keys(updates).length === 0) {
		throw createError(400, 'At least one updatable field is required');
	}

	if (updates.price !== undefined) {
		const parsedPrice = Number(updates.price);
		if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
			throw createError(400, 'price must be a non-negative number');
		}
		updates.price = parsedPrice;
	}

	if (updates.stock !== undefined) {
		const parsedStock = Number(updates.stock);
		if (!Number.isInteger(parsedStock) || parsedStock < 0) {
			throw createError(400, 'stock must be a non-negative integer');
		}
		updates.stock = parsedStock;
	}

	return updates;
}

async function updateProductInDb(productId, payload) {
	const updates = parseUpdatePayload(payload);
	const entries = Object.entries(updates);
	const setClauses = entries.map(([field], index) => `${field} = $${index + 1}`);
	const values = entries.map(([, value]) => value);

	setClauses.push('updated_at = NOW()');
	values.push(productId);

	const queryText = `
		UPDATE products
		SET ${setClauses.join(', ')}
		WHERE id = $${values.length}
		RETURNING *
	`;

	const result = await db.query(queryText, values);
	return result.rows[0] || null;
}

async function getProductById(id, backend) {
	const productId = parseProductId(id);
	const { redis, memcached } = await getCacheClients();

	if (backend === 'redis') {
		const key = redisProductKey(productId);
		const cached = await redis.get(key);
		if (cached) {
			return {
				source: 'cache',
				product: JSON.parse(cached),
			};
		}

		const product = await loadFromDb(productId);
		if (!product) {
			return null;
		}

		await redis.set(key, JSON.stringify(product), { EX: config.cacheTtlSeconds });

		return {
			source: 'db',
			product,
		};
	}

	if (backend === 'memcached') {
		const version = await getMemcachedVersion(memcached);
		const key = memcachedProductKey(version, productId);
		const cached = await memcachedGet(memcached, key);
		if (cached) {
			return {
				source: 'cache',
				product: JSON.parse(cached.toString()),
			};
		}

		const product = await loadFromDb(productId);
		if (!product) {
			return null;
		}

		await memcachedSet(getMemcachedClient(config.cacheTtlSeconds), key, JSON.stringify(product));

		return {
			source: 'db',
			product,
		};
	}

	throw createError(400, `Unsupported cache backend: ${backend}`);
}

async function updateProductById(id, payload, backend) {
	const productId = parseProductId(id);
	const updatedProduct = await updateProductInDb(productId, payload || {});

	if (!updatedProduct) {
		return null;
	}

	const { redis, memcached } = await getCacheClients();
	const invalidation = await invalidateProductCache({
		backend,
		productId,
		redisClient: redis,
		memcachedClient: memcached,
	});

	return {
		product: updatedProduct,
		invalidation,
	};
}

module.exports = {
	getProductById,
	updateProductById,
};
