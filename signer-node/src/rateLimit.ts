import rateLimit from "express-rate-limit";

export const getSignatureLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: {
        error: "Too many requests",
        details: "Please try again later",
    },
    standardHeaders: true,
    legacyHeaders: false,
});
