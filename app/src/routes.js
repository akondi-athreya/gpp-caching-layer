
const express = require('express');
const productService = require('./services/productService');
const sessionService = require('./services/sessionService');
const leaderboardService = require('./services/leaderboardService');

const router = express.Router();

router.get('/products/:id', async (req, res) => {
    try {
        const result = await productService.getProductById(req.params.id, req.cacheBackend);

        if (!result) {
            return res.status(404).json({
                error: 'Product not found',
            });
        }

        return res.status(200).json({
            cacheBackend: req.cacheBackend,
            source: result.source,
            product: result.product,
        });
    } catch (error) {
        console.error('GET /products/:id failed', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Internal server error',
        });
    }
});

router.post('/products/:id', async (req, res) => {
    try {
        const result = await productService.updateProductById(req.params.id, req.body, req.cacheBackend);

        if (!result) {
            return res.status(404).json({
                error: 'Product not found',
            });
        }

        return res.status(200).json({
            cacheBackend: req.cacheBackend,
            message: 'Product updated and cache invalidated',
            invalidation: result.invalidation,
            product: result.product,
        });
    } catch (error) {
        console.error('POST /products/:id failed', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Internal server error',
        });
    }
});

router.get('/leaderboard', async (req, res) => {
    try {
        const items = await leaderboardService.getLeaderboard(req.cacheBackend, 10);
        return res.status(200).json({
            cacheBackend: req.cacheBackend,
            items,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Internal server error',
        });
    }
});

router.post('/products/:id/view', async (req, res) => {
    try {
        const score = await leaderboardService.incrementView(req.params.id, req.cacheBackend, { useLock: true });
        return res.status(200).json({
            cacheBackend: req.cacheBackend,
            productId: String(req.params.id),
            score,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Internal server error',
        });
    }
});

router.get('/session/:id', async (req, res) => {
    try {
        const session = await sessionService.getSessionById(req.params.id, req.cacheBackend);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        return res.status(200).json({
            cacheBackend: req.cacheBackend,
            session,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Internal server error',
        });
    }
});

router.post('/session/:id', async (req, res) => {
    try {
        const result = await sessionService.patchSessionById(req.params.id, req.body, req.cacheBackend);
        return res.status(200).json({
            cacheBackend: req.cacheBackend,
            storageType: result.storageType,
            session: result.session,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Internal server error',
        });
    }
});

module.exports = router;