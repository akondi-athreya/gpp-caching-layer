async function memcachedGet(client, key) {
	try {
		const result = await client.get(key);
		return result.value || null;
	} catch (err) {
		console.error('Memcached GET error:', err);
		throw err;
	}
}

async function memcachedSet(client, key, value) {
	try {
		const success = await client.set(key, value);
		return Boolean(success);
	} catch (err) {
		console.error('Memcached SET error:', err);
		throw err;
	}
}

async function memcachedAdd(client, key, value) {
	try {
		const success = await client.add(key, value);
		return Boolean(success);
	} catch (err) {
		console.error('Memcached ADD error:', err);
		throw err;
	}
}

async function memcachedDelete(client, key) {
	try {
		const success = await client.delete(key);
		return Boolean(success);
	} catch (err) {
		console.error('Memcached DELETE error:', err);
		throw err;
	}
}

module.exports = {
	memcachedGet,
	memcachedSet,
	memcachedAdd,
	memcachedDelete,
};
