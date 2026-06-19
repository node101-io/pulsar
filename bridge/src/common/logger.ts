import winston from "winston";

const isProduction = process.env.NODE_ENV === "production";
const isDocker = !!process.env.DOCKER_CONTAINER;

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
    defaultMeta: {
        service: "pulsar-bridge",
        environment: process.env.NODE_ENV || "development",
        container: process.env.HOSTNAME || "local",
    },
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
        winston.format.errors({ stack: true }),
        winston.format.metadata({
            fillExcept: ["message", "level", "timestamp"],
        }),
        isDocker || isProduction
            ? winston.format.json()
            : winston.format.combine(
                  winston.format.colorize(),
                  winston.format.printf(
                      ({ timestamp, level, message, metadata }) => {
                          const meta =
                              metadata &&
                              typeof metadata === "object" &&
                              Object.keys(metadata).length
                                  ? JSON.stringify(metadata, null, 2)
                                  : "";
                          return `${timestamp} [${level}]: ${message}${
                              meta ? `\n${meta}` : ""
                          }`;
                      },
                  ),
              ),
    ),
    transports: [
        new winston.transports.Console({
            handleExceptions: true,
            handleRejections: true,
        }),
    ],
    exitOnError: false,
});

if (!isDocker) {
    logger.add(
        new winston.transports.File({
            filename: "logs/bridge-error.log",
            level: "error",
            format: winston.format.json(),
            maxsize: 50 * 1024 * 1024,
            maxFiles: 5,
        }),
    );

    logger.add(
        new winston.transports.File({
            filename: "logs/bridge-combined.log",
            format: winston.format.json(),
            maxsize: 100 * 1024 * 1024,
            maxFiles: 3,
        }),
    );
}

export default logger;
