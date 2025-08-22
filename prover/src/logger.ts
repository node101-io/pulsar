import winston from "winston";
import { randomBytes } from "crypto";

interface LogContext {
    correlationId?: string;
    jobId?: string;
    workerId?: string;
    workerType?: string;
    blockHeight?: number;
    txHash?: string;
    userId?: string;
    duration?: number;
    errorCode?: string;
    [key: string]: any;
}

class StructuredLogger {
    private winston: winston.Logger;
    private defaultContext: LogContext = {};

    constructor() {
        const isProduction = process.env.NODE_ENV === "production";
        const isDocker = !!process.env.DOCKER_CONTAINER;

        this.winston = winston.createLogger({
            level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
            defaultMeta: {
                service: "pulsar-prover",
                version: process.env.npm_package_version || "unknown",
                environment: process.env.NODE_ENV || "development",
                container: process.env.HOSTNAME || "local",
                pid: process.pid,
            },
            format: winston.format.combine(
                winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
                winston.format.errors({ stack: true }),
                winston.format.metadata({ fillExcept: ["message", "level", "timestamp"] }),

                isDocker || isProduction
                    ? winston.format.json()
                    : winston.format.combine(
                          winston.format.colorize(),
                          winston.format.printf(({ timestamp, level, message, metadata }) => {
                              const meta =
                                  metadata &&
                                  typeof metadata === "object" &&
                                  Object.keys(metadata).length
                                      ? JSON.stringify(metadata, null, 2)
                                      : "";
                              return `${timestamp} [${level}]: ${message}${
                                  meta ? `\n${meta}` : ""
                              }`;
                          })
                      )
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
            this.winston.add(
                new winston.transports.File({
                    filename: "logs/prover-error.log",
                    level: "error",
                    format: winston.format.json(),
                    maxsize: 50 * 1024 * 1024,
                    maxFiles: 5,
                })
            );

            this.winston.add(
                new winston.transports.File({
                    filename: "logs/prover-combined.log",
                    format: winston.format.json(),
                    maxsize: 100 * 1024 * 1024,
                    maxFiles: 3,
                })
            );
        }
    }

    setDefaultContext(context: LogContext) {
        this.defaultContext = { ...this.defaultContext, ...context };
    }

    generateCorrelationId(): string {
        return randomBytes(16).toString("hex");
    }

    child(context: LogContext): StructuredLogger {
        const childLogger = new StructuredLogger();
        childLogger.defaultContext = { ...this.defaultContext, ...context };
        childLogger.winston = this.winston;
        return childLogger;
    }

    private log(level: string, message: string, context: LogContext = {}) {
        const fullContext = {
            ...this.defaultContext,
            ...context,
            correlationId:
                context.correlationId ||
                this.defaultContext.correlationId ||
                this.generateCorrelationId(),
        };

        this.winston.log(level, message, fullContext);
    }

    debug(message: string, context: LogContext = {}) {
        this.log("debug", message, context);
    }

    info(message: string, context: LogContext = {}) {
        this.log("info", message, context);
    }

    warn(message: string, context: LogContext = {}) {
        this.log("warn", message, context);
    }

    error(message: string, error?: Error | any, context: LogContext = {}) {
        const errorContext =
            error instanceof Error
                ? {
                      ...context,
                      error: {
                          message: error.message,
                          stack: error.stack,
                          name: error.name,
                          code: (error as any).code,
                      },
                  }
                : { ...context, error: error };

        this.log("error", message, errorContext);
    }

    jobStarted(jobId: string, jobType: string, context: LogContext = {}) {
        this.info(`Job started: ${jobType}`, {
            ...context,
            jobId,
            jobType,
            event: "job_started",
        });
    }

    jobCompleted(jobId: string, jobType: string, duration: number, context: LogContext = {}) {
        this.info(`Job completed: ${jobType}`, {
            ...context,
            jobId,
            jobType,
            duration,
            event: "job_completed",
        });
    }

    jobFailed(jobId: string, jobType: string, error: Error, context: LogContext = {}) {
        this.error(`Job failed: ${jobType}`, error, {
            ...context,
            jobId,
            jobType,
            event: "job_failed",
        });
    }

    blockProcessing(blockHeight: number, context: LogContext = {}) {
        this.info(`Processing block: ${blockHeight}`, {
            ...context,
            blockHeight,
            event: "block_processing",
        });
    }

    proofGenerated(proofType: string, duration: number, context: LogContext = {}) {
        this.info(`Proof generated: ${proofType}`, {
            ...context,
            proofType,
            duration,
            event: "proof_generated",
        });
    }

    contractInteraction(method: string, txHash?: string, context: LogContext = {}) {
        this.info(`Contract interaction: ${method}`, {
            ...context,
            method,
            txHash,
            event: "contract_interaction",
        });
    }

    performance(operation: string, duration: number, context: LogContext = {}) {
        this.info(`Performance: ${operation}`, {
            ...context,
            operation,
            duration,
            event: "performance",
        });
    }

    dbOperation(
        operation: string,
        collection?: string,
        duration?: number,
        context: LogContext = {}
    ) {
        this.debug(`Database operation: ${operation}`, {
            ...context,
            operation,
            collection,
            duration,
            event: "db_operation",
        });
    }

    networkRequest(
        url: string,
        method: string,
        statusCode?: number,
        duration?: number,
        context: LogContext = {}
    ) {
        this.debug(`Network request: ${method} ${url}`, {
            ...context,
            url,
            method,
            statusCode,
            duration,
            event: "network_request",
        });
    }
}

const logger = new StructuredLogger();

export default logger;
export { StructuredLogger, LogContext };
