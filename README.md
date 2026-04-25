# Caching Layer API

Production-grade product catalog API that demonstrates cache design trade-offs using Redis 7 and Memcached 1.6 across read-through caching, invalidation, distributed rate limiting, session storage, and leaderboard consistency.

## Why This Project Exists

This repository is designed to compare backend behavior under realistic API patterns, not just synthetic key-value tests.

It answers practical questions such as:

- How do Redis and Memcached differ under read-heavy product workloads?
- What consistency is lost with naive Memcached read-modify-write flows?
- How should invalidation and rate limiting change per backend?
- What are the memory and latency trade-offs under benchmark load?

## Key Features

- Read-through product cache with backend selection per request
- Backend-specific invalidation strategy
- Global rate limiting (Redis Lua atomic counter, Memcached text protocol fallback)
- Session patch/read endpoints with backend-specific storage representation
- Leaderboard view counter with lock and no-lock Memcached implementations
- Docker Compose stack with health checks and deterministic DB seeding
- Reproducible benchmark and consistency-check scripts

## Architecture

### Runtime Components

- API: Node.js 20 + Express 5 (`app/src/server.js`)
- Database: PostgreSQL 16 (`db/init/001_schema.sql`)
- Cache Backends:
    - Redis 7 (strings, hashes, sorted sets, Lua)
    - Memcached 1.6 (JSON blobs, versioned keys, lock via add/delete)

### Request Flow

1. Request hits `/api/*` route group (root aliases are auto-rewritten to `/api/*` for supported contracts).
2. `backendSelector` resolves backend from `X-Cache-Backend` or `DEFAULT_CACHE_BACKEND`.
3. `rateLimiter` applies a per-user, per-minute limit and writes standard rate-limit headers.
4. Route handler executes backend-aware service logic.

### Backend Selection

- Header override: `X-Cache-Backend: redis|memcached`
- Default fallback: `DEFAULT_CACHE_BACKEND`

## Caching Patterns Implemented

### 1. Product Read-Through Cache

- Endpoint: `GET /products/:id` (also available as `/api/products/:id`)
- Strategy:
    - Cache hit returns `{ source: "cache" }`
    - Cache miss fetches from Postgres, stores with TTL, returns `{ source: "db" }`

Key format:

- Redis: `product:{id}`
- Memcached: `v{cacheVersion}:product:{id}`

### 2. Product Update + Invalidation

- Endpoint: `POST /products/:id`
- DB row is updated first, then invalidated by backend strategy:

- Redis:
    - Delete exact product key
    - Publish invalidation event on `cache:invalidate`
- Memcached:
    - Bump global version key (`cache:version`)
    - Old entries naturally become stale by key version mismatch

### 3. Leaderboard Increment Consistency

- Endpoints:
    - `POST /products/:id/view`
    - `GET /leaderboard`

- Redis: atomic `ZINCRBY` on sorted set (`leaderboard:views`)
- Memcached:
    - No-lock mode available for consistency demonstrations
    - Lock mode uses `add`/`delete` lock key with exponential backoff to avoid lost updates

### 4. Session Storage

- Endpoints:
    - `GET /session/:id`
    - `POST /session/:id`

- Redis: hash storage with `EXPIRE`
- Memcached: full JSON blob merge + overwrite with TTL

### 5. Rate Limiting

- Applied to all `/api/*` endpoints via middleware
- Window: 60 seconds
- Headers emitted:
    - `X-RateLimit-Limit`
    - `X-RateLimit-Remaining`
    - `X-RateLimit-Reset-Seconds`

Implementation:

- Redis: Lua script (`INCR` + `EXPIRE` atomically)
- Memcached: text protocol `incr` + race-safe `add` initialization fallback

## Repository Layout

```text
.
|-- app/
|   |-- src/
|   |   |-- middleware/        # backend selection and rate limiting
|   |   |-- services/          # product/session/leaderboard/invalidation logic
|   |   |-- server.js          # API bootstrap and health endpoint
|   |-- scripts/
|   |   |-- seedProducts.js    # deterministic high-volume product seeding
|   |   |-- consistencyCheck.js
|   |-- Dockerfile
|-- db/init/001_schema.sql
|-- benchmarks/run_benchmarks.sh
|-- results/                   # benchmark output artifacts
|-- docker-compose.yml
|-- .env.example
```

## Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- Optional for local script execution outside containers:
    - Node.js 20+
    - npm

## Configuration

Create environment configuration from `.env.example` if you are running outside Docker.

Required variables:

| Variable | Description | Default in `.env.example` |
|---|---|---|
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `MEMCACHED_URL` | Memcached target(s) | `memcached:11211` |
| `DATABASE_URL` | Postgres connection string | `postgres://catalog:catalog@db:5432/catalog` |
| `API_PORT` | API bind port | `3000` |
| `CACHE_TTL_SECONDS` | Product cache TTL | `300` |
| `DEFAULT_CACHE_BACKEND` | Default backend (`redis` or `memcached`) | `redis` |
| `RATE_LIMIT_PER_MINUTE` | Per-user request budget | `100` |

Optional variable:

- `SKIP_EXTERNAL_SERVICES=true` to run the API without live Redis/Memcached/Postgres (used in `render.yaml` deployment mode).

## Running the Stack (Recommended)

From repository root:

```bash
docker compose up -d --build
```

Services:

- API: `http://localhost:3000`
- Health: `http://localhost:3000/health`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- Memcached: `localhost:11211`

Stop:

```bash
docker compose down
```

## API Contracts

All endpoints support both root path and `/api`-prefixed path.

### Health

```http
GET /health
```

Response:

```json
{ "status": "OK" }
```

### Product Read

```http
GET /products/:id
X-Cache-Backend: redis|memcached   # optional
```

Successful response shape:

```json
{
    "cacheBackend": "redis",
    "source": "cache",
    "product": { "id": 1 }
}
```

### Product Update

```http
POST /products/:id
Content-Type: application/json
```

Body accepts one or more of:

- `name`, `description`, `price`, `currency`, `category`, `stock`

### Leaderboard

```http
POST /products/:id/view
GET /leaderboard
```

### Session

```http
POST /session/:id
GET /session/:id
```

## Developer Workflows

Run commands from `app/` unless noted.

Start API locally:

```bash
npm run dev
```

Seed products:

```bash
npm run seed
```

Run consistency checks:

```bash
npm run consistency
```

Run cache benchmarks:

```bash
npm run benchmark
```

Notes:

- Seeding defaults to `MAX_PRODUCTS=100000` with batch size `1000`.
- `BATCH_SIZE` must be `1000` or `2000`.
- Benchmark script requires Docker network `caching-layer_default` (created by Compose).

## Benchmark Snapshot

Summary for pipeline depth 1 (see `results/` for full data):

- Redis: 263,384.81 ops/sec, 0.655 ms p99
- Memcached: 126,042.35 ops/sec, 4.319 ms p99

Memory comparison for 100,000 products (~2.2 KB each):

| Storage Backend | Reported Used Memory (MB) | Overhead per Key (Bytes) |
|---|---:|---:|
| Redis 7 | 251.91 | 438 |
| Memcached 1.6 | 218.38 | 86 |

## Consistency Results

Verified by `app/scripts/consistencyCheck.js`:

| Test Case | Final Count (Target: 1000) | Lost Increments |
|---|---:|---:|
| Redis (atomic `ZINCRBY`) | 1000 | 0 |
| Memcached (no lock) | 178 | 822 |
| Memcached (distributed lock) | 1000 | 0 |

This highlights the classic trade-off: lock-free updates maximize throughput but can lose writes under contention.

## Operational Notes

- Graceful shutdown handles `SIGINT`/`SIGTERM`, closes HTTP server and Redis clients cleanly.
- `db-seed` runs once and must complete before `app` starts in Compose.
- Health checks are configured for all services in `docker-compose.yml`.
- Render deployment is configured in `render.yaml` with `SKIP_EXTERNAL_SERVICES=true` for deployment-only mode.

## Troubleshooting

- `DEFAULT_CACHE_BACKEND is required`
    - Set `DEFAULT_CACHE_BACKEND` to `redis` or `memcached`.

- `Invalid X-Cache-Backend header`
    - Use only `redis` or `memcached` in request header.

- Benchmark script reports missing network
    - Start stack first: `docker compose up -d`.

- Memcached rate limiter errors
    - Confirm `MEMCACHED_URL` host:port is reachable from API container.

## Future Enhancements

- Add automated API tests with backend matrix (`redis`, `memcached`)
- Add OpenAPI spec generation and contract validation
- Add observability (structured logs, traces, metrics export)
- Harden Docker image (multi-stage build, non-root runtime, lockfile-based installs)

## License

ISC
