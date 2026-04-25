#!/usr/bin/env node

const { Client } = require('pg');

const MAX_PRODUCTS = Math.min(Number(process.env.MAX_PRODUCTS || 100000), 100000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 1000);

if (![1000, 2000].includes(BATCH_SIZE)) {
	console.error('BATCH_SIZE must be 1000 or 2000');
	process.exit(1);
}

const DESCRIPTION_BLOCK =
	'Engineered for repeatable benchmark seeding, this product profile includes stable text, predictable structure, and deterministic variation by identifier. It is intentionally verbose to produce a payload near two kilobytes for caching and serialization tests. ';

function qi(identifier) {
	return `"${String(identifier).replace(/"/g, '""')}"`;
}

function pseudoUuidFromInt(n) {
	const hex = n.toString(16).padStart(32, '0').slice(-32);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildDescription(id) {
	let text = `Product ${id} deterministic description. `;
	while (text.length < 1900) {
		text += `ID:${id}. ${DESCRIPTION_BLOCK}`;
	}
	return text.slice(0, 1900);
}

function valueForColumn(col, id) {
	const name = col.column_name.toLowerCase();
	const dataType = (col.data_type || '').toLowerCase();
	const udt = (col.udt_name || '').toLowerCase();

	if (name === 'id') return id;
	if (name.includes('description')) return buildDescription(id);
	if (name === 'name' || name === 'title') return `Product ${id}`;
	if (name.includes('sku')) return `SKU-${String(id).padStart(8, '0')}`;
	if (name.includes('category')) return `category-${id % 20}`;
	if (name.includes('brand')) return `brand-${id % 50}`;
	if (name.includes('image')) return `https://cdn.example.com/products/${id}.jpg`;

	if (dataType.includes('timestamp')) return new Date(Date.UTC(2024, 0, 1, 0, 0, id % 60));
	if (dataType === 'date') return '2024-01-01';
	if (dataType === 'boolean') return id % 2 === 0;

	if (
		dataType === 'smallint' ||
		dataType === 'integer' ||
		dataType === 'bigint' ||
		dataType === 'numeric' ||
		dataType === 'real' ||
		dataType === 'double precision' ||
		udt === 'int2' ||
		udt === 'int4' ||
		udt === 'int8' ||
		udt === 'numeric' ||
		udt === 'float4' ||
		udt === 'float8'
	) {
		if (name.includes('price') || name.includes('amount') || name.includes('cost')) {
			return Number((((id % 100000) + 1000) / 100).toFixed(2));
		}
		return id % 10000;
	}

	if (dataType === 'json' || dataType === 'jsonb') {
		return {
			seed: true,
			id,
			tags: [`tag-${id % 10}`, `tag-${(id + 3) % 10}`],
			note: 'deterministic',
		};
	}

	if (dataType === 'uuid' || udt === 'uuid') return pseudoUuidFromInt(id);

	if (udt.startsWith('_')) return [];

	if (
		dataType.includes('character') ||
		dataType.includes('text') ||
		udt === 'varchar' ||
		udt === 'text' ||
		udt === 'bpchar'
	) {
		return `${name}-${id}`;
	}

	return null;
}

async function getColumns(client) {
	const { rows } = await client.query(
		`
		SELECT column_name, data_type, udt_name, is_nullable, column_default
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'products'
		ORDER BY ordinal_position
		`
	);
	return rows;
}

function pickInsertColumns(columns) {
	const preferred = new Set([
		'id',
		'name',
		'title',
		'description',
		'price',
		'category',
		'brand',
		'sku',
		'stock',
		'inventory',
		'image_url',
		'created_at',
		'updated_at',
		'metadata',
		'attributes',
		'is_active',
	]);

	const required = columns.filter((c) => c.is_nullable === 'NO' && c.column_default == null).map((c) => c.column_name);
	const combined = new Set(['id', ...required, ...Array.from(preferred)]);

	return columns.filter((c) => combined.has(c.column_name));
}

async function main() {
	const client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	try {
		const columns = await getColumns(client);
		if (!columns.length) throw new Error('products table not found in public schema');
		if (!columns.some((c) => c.column_name === 'id')) throw new Error('products.id column is required');

		const insertColumns = pickInsertColumns(columns);
		let insertedCount = 0;

		for (let start = 1; start <= MAX_PRODUCTS; start += BATCH_SIZE) {
			const end = Math.min(start + BATCH_SIZE - 1, MAX_PRODUCTS);
			const values = [];
			const placeholders = [];

			for (let id = start; id <= end; id += 1) {
				const rowPlaceholders = [];
				for (const col of insertColumns) {
					values.push(valueForColumn(col, id));
					rowPlaceholders.push(`$${values.length}`);
				}
				placeholders.push(`(${rowPlaceholders.join(', ')})`);
			}

			const sql = `
				INSERT INTO products (${insertColumns.map((c) => qi(c.column_name)).join(', ')})
				VALUES ${placeholders.join(', ')}
				ON CONFLICT (id) DO NOTHING
			`;

			const result = await client.query(sql, values);
			insertedCount += result.rowCount || 0;
		}

		const totalRes = await client.query('SELECT COUNT(*)::bigint AS total FROM products');
		const totalCount = Number(totalRes.rows[0].total);

		console.log(`Inserted: ${insertedCount}`);
		console.log(`Total: ${totalCount}`);
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error('Seeding failed:', err.message);
	process.exit(1);
});

