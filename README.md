# High-Performance Product Catalog API with Complex Caching Patterns

This project implements a high-performance product catalog API utilizing both Redis 7 and Memcached 1.6 to demonstrate various caching patterns, atomicity, and performance trade-offs.

## Memory Comparison

Comparison of memory overhead for storing 100,000 product objects (~2.2KB each).

| Storage Backend | Reported Used Memory (MB) | Overhead per Key (Bytes) |
|-----------------|---------------------------|--------------------------|
| Redis 7         | 251.91                    | 438                      |
| Memcached 1.6   | 218.38                    | 86                       |

## Benchmark Results

Full benchmark results can be found in the `results/` directory.

### Summary (Pipeline Depth 1)

- **Redis**: 263,384.81 ops/sec, 0.655ms p99 latency
- **Memcached**: 126,042.35 ops/sec, 4.319ms p99 latency

## Consistency Results

Verified via `scripts/consistencyCheck.js`.

| Test Case | Final Count (Target: 1000) | Lost Increments |
|-----------|----------------------------|-----------------|
| Redis (Atomic ZINCRBY) | 1000 | 0 |
| Memcached (No Lock) | 178 | 822 |
| Memcached (Distributed Lock) | 1000 | 0 |

## Setup and Running

1. `docker-compose up -d`
2. Services will be available at:
    - API: http://localhost:3000
    - Redis: localhost:6379
    - Memcached: localhost:11211
    - DB: localhost:5432
