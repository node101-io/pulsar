import winston from "winston";

const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    defaultMeta: { service: "user-service" },
    transports: [
        new winston.transports.File({ filename: "logs/signer-node-error.log", level: "error" }),
        new winston.transports.File({ filename: "logs/signer-node-combined.log" }),
    ],
});

if (process.env.NODE_ENV !== "production") {
    logger.add(
        new winston.transports.Console({
            format: winston.format.simple(),
        })
    );
}

export default logger;
