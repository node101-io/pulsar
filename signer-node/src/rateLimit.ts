import express, { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import logger from "./logger.js";

export function localhostOnly(req: Request, res: Response, next: NextFunction): void {
    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const isLocalhost =
        clientIp === "127.0.0.1" ||
        clientIp === "::1" ||
        clientIp === "::ffff:127.0.0.1" ||
        clientIp?.includes("127.0.0.1");

    if (!isLocalhost) {
        logger.warn(`Unauthorized access attempt from IP: ${clientIp}`);
        res.status(403).json({
            error: "Forbidden",
            details: "This endpoint is only accessible from localhost",
        });
        return;
    }

    next();
}

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
