#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="$ROOT_DIR/results"
REDIS_OUT="$RESULTS_DIR/redis_bench.txt"
MEMCACHED_OUT="$RESULTS_DIR/memcached_bench.txt"
NETWORK_NAME="caching-layer_default"
MEMTIER_IMAGE="redislabs/memtier_benchmark:latest"

mkdir -p "$RESULTS_DIR"
: > "$REDIS_OUT"
: > "$MEMCACHED_OUT"

if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
	echo "Compose network $NETWORK_NAME not found. Run: docker compose up -d"
	exit 1
fi

run_case() {
	local backend="$1"
	local protocol="$2"
	local host="$3"
	local port="$4"
	local pipeline="$5"
	local out_file="$6"

	{
		echo "============================================================"
		echo "backend=$backend pipeline=$pipeline started=$(date -u +%FT%TZ)"
		docker run --rm --network "$NETWORK_NAME" "$MEMTIER_IMAGE" \
			--server="$host" \
			--port="$port" \
			--protocol="$protocol" \
			--threads=4 \
			--clients=20 \
			--test-time=20 \
			--ratio=9:1 \
			--key-pattern=G:G \
			--data-size=2048 \
			--key-minimum=1 \
			--key-maximum=100000 \
			--pipeline="$pipeline" \
			--hide-histogram
		echo
	} >> "$out_file"
}

for pipeline in 1 10 50; do
	run_case "redis" "redis" "redis" "6379" "$pipeline" "$REDIS_OUT"
done

for pipeline in 1 10 50; do
	run_case "memcached" "memcache_text" "memcached" "11211" "$pipeline" "$MEMCACHED_OUT"
done

echo "Benchmark results written to:"
echo "  $REDIS_OUT"
echo "  $MEMCACHED_OUT"
