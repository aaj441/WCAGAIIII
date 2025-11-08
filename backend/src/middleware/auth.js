const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

/**
 * WCAGAI v4.0 Authentication & Rate Limiting
 * Implements tiered access control for revenue streams
 */

// JWT Secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'wcagai-v4-revenue-secret-2025';

// Rate limiting by tier
const createRateLimit = (tier) => {
    const limits = {
        developer: { windowMs: 15 * 60 * 1000, max: 1000 }, // 1k scans/15min
        compliance: { windowMs: 15 * 60 * 1000, max: 10000 }, // 10k scans/15min  
        enterprise: { windowMs: 15 * 60 * 1000, max: 100000 } // 100k scans/15min
    };
    
    const limit = limits[tier] || limits.developer;
    
    return rateLimit({
        windowMs: limit.windowMs,
        max: limit.max,
        message: {
            error: 'Rate limit exceeded',
            tier: tier,
            upgradeUrl: tier === 'developer' ? '/pricing' : '/contact'
        },
        standardHeaders: true,
        legacyHeaders: false,
    });
};

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'Please sign in or upgrade your plan',
            pricingUrl: '/pricing'
        });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({
                error: 'Invalid or expired token',
                message: 'Please refresh your session'
            });
        }
        
        req.user = user;
        
        // Apply rate limiting based on user tier
        const tierLimiter = createRateLimit(user.plan || 'developer');
        return tierLimiter(req, res, next);
    });
};

// Middleware to check specific features
const requireFeature = (feature) => {
    return (req, res, next) => {
        const user = req.user;
        const features = {
            developer: ['url_scan', 'basic_reports'],
            compliance: ['url_scan', 'vertical_discovery', 'ai_fixes', 'legal_risk'],
            enterprise: ['url_scan', 'vertical_discovery', 'ai_fixes', 'legal_risk', 'api_access', 'white_label']
        };
        
        if (!features[user.plan]?.includes(feature)) {
            return res.status(403).json({
                error: 'Feature not available in your plan',
                feature: feature,
                currentPlan: user.plan,
                upgradeUrl: '/pricing',
                upgradePrice: feature === 'vertical_discovery' ? 299 : 
                             feature === 'ai_fixes' ? 299 : 999
            });
        }
        
        next();
    };
};

// Credit system middleware for AI fixes
const checkCredits = async (req, res, next) => {
    const user = req.user;
    const cost = req.body.cost || 1; // Default 1 credit
    
    // In production, check database for remaining credits
    const remainingCredits = user.credits || 0;
    
    if (remainingCredits < cost) {
        return res.status(402).json({
            error: 'Insufficient credits',
            required: cost,
            remaining: remainingCredits,
            purchaseUrl: '/credits',
            upgradeOptions: {
                starter: { credits: 100, price: 49 },
                pro: { credits: 1000, price: 399 },
                enterprise: { credits: 10000, price: 2999 }
            }
        });
    }
    
    // Deduct credits (in production, update database)
    req.user.credits = remainingCredits - cost;
    
    next();
};

// Generate JWT token for user
const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            plan: user.plan || 'developer',
            credits: user.credits || 0,
            company: user.company
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};

// Middleware to log revenue events
const trackRevenueEvent = (eventType) => {
    return (req, res, next) => {
        const event = {
            type: eventType,
            userId: req.user?.id,
            plan: req.user?.plan,
            timestamp: new Date().toISOString(),
            ip: req.ip,
            userAgent: req.get('User-Agent')
        };
        
        console.log('📊 Revenue Event:', JSON.stringify(event));
        
        // In production, send to analytics (Mixpanel, Amplitude, etc.)
        next();
    };
};

module.exports = {
    authenticateToken,
    requireFeature,
    checkCredits,
    generateToken,
    trackRevenueEvent,
    createRateLimit
};