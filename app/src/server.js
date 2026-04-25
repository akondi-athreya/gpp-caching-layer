const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const config = require('./config');
const routes = require('./routes');
const backendSelector = require('./middleware/backendSelector');
const rateLimiter = require('./middleware/rateLimiter');
const { connectRedis } = require('./redisClient');
const {
    INVALIDATION_CHANNEL,
} = require('./services/invalidationService');

const app = express();
let server = null;
let redisClient = null;
let invalidationSubscriber = null;

app.use(express.json());

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Support both required root contract paths and existing /api-prefixed paths.
// Rewrite only known API paths to avoid duplicate middleware execution.
const rootApiPathMatchers = [
    /^\/products\/\d+$/,
    /^\/products\/\d+\/view$/,
    /^\/leaderboard$/,
    /^\/session\/[^/]+$/,
];

app.use((req, res, next) => {
    const alreadyPrefixed = req.path === '/api' || req.path.startsWith('/api/');
    if (alreadyPrefixed) {
        return next();
    }

    const isRootApiPath = rootApiPathMatchers.some((matcher) => matcher.test(req.path));
    if (!isRootApiPath) {
        return next();
    }

    req.url = `/api${req.url}`;
    return next();
});

app.use('/api', backendSelector, rateLimiter, routes);

async function startServer() {
    try {
        // Loading config is part of startup and validates required env vars.
        const port = config.apiPort;

        redisClient = await connectRedis();

        invalidationSubscriber = redisClient.duplicate();
        invalidationSubscriber.on('error', (error) => {
            console.error('Redis invalidation subscriber error', error);
        });
        await invalidationSubscriber.connect();
        await invalidationSubscriber.subscribe(INVALIDATION_CHANNEL, async (message) => {
            try {
                const payload = JSON.parse(message);
                if (payload && payload.key) {
                    await redisClient.del(payload.key);
                }
            } catch (error) {
                console.error('Failed to process invalidation message', error);
            }
        });

        server = app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;

    console.log(`${signal} received. Shutting down gracefully...`);

    try {
        if (server) {
            await new Promise((resolve) => {
                server.close(() => resolve());
            });
        }

        if (redisClient && redisClient.isOpen) {
            await redisClient.quit();
            console.log('Redis client closed');
        }

		if (invalidationSubscriber && invalidationSubscriber.isOpen) {
			await invalidationSubscriber.quit();
			console.log('Redis invalidation subscriber closed');
		}

        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
});

startServer();