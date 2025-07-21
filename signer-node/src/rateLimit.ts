import rateLimit from "express-rate-limit";

export const signActionQueueLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 10,
    message: {
        message: "Too many requests",
    },
    standardHeaders: true,
    legacyHeaders: false,
});
