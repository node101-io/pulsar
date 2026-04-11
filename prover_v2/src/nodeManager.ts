import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WorkerDef {
    name: string;
    script: string;
    color: string;
    extraArgs?: string[];
}

const WORKERS: WorkerDef[] = [
    {
        name: "main",
        script: join(__dirname, "index.js"),
        color: "\x1b[36m", // cyan
    },
    {
        name: "block-prover",
        script: join(__dirname, "workers/block-prover/index.js"),
        color: "\x1b[33m", // yellow
        extraArgs: ["--max-old-space-size=8192"],
    },
    {
        name: "aggregator",
        script: join(__dirname, "workers/aggregator/index.js"),
        color: "\x1b[35m", // magenta
        extraArgs: ["--max-old-space-size=8192"],
    },
    {
        name: "settlement-prover",
        script: join(__dirname, "workers/settlement-prover/index.js"),
        color: "\x1b[34m", // blue
        extraArgs: ["--max-old-space-size=8192"],
    },
    {
        name: "settler",
        script: join(__dirname, "workers/settler/index.js"),
        color: "\x1b[32m", // green
        extraArgs: ["--max-old-space-size=8192"],
    },
];

const RESET = "\x1b[0m";
const RESTART_DELAY_MS = 3000;

function prefix(name: string, color: string): string {
    const pad = 18;
    return `${color}[${name.padEnd(pad)}]${RESET} `;
}

function spawnWorker(def: WorkerDef): ChildProcess {
    const nodeArgs = [...(def.extraArgs ?? []), def.script];
    const proc = spawn(process.execPath, nodeArgs, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
    });

    const pre = prefix(def.name, def.color);

    proc.stdout.on("data", (data: Buffer) => {
        data.toString()
            .split("\n")
            .filter(Boolean)
            .forEach((line) => {
                process.stdout.write(pre + line + "\n");
            });
    });

    proc.stderr.on("data", (data: Buffer) => {
        data.toString()
            .split("\n")
            .filter(Boolean)
            .forEach((line) => {
                process.stderr.write(pre + line + "\n");
            });
    });

    proc.on("exit", (code, signal) => {
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        process.stdout.write(
            `${prefix(
                def.name,
                def.color,
            )}process exited (${reason}), restarting in ${
                RESTART_DELAY_MS / 1000
            }s...\n`,
        );
        setTimeout(() => spawnWorker(def), RESTART_DELAY_MS);
    });

    process.stdout.write(
        `${prefix(def.name, def.color)}started (pid ${proc.pid})\n`,
    );
    return proc;
}

// Graceful shutdown
const procs: ChildProcess[] = [];

function shutdown() {
    process.stdout.write("\nShutting down all workers...\n");
    procs.forEach((p) => p.kill("SIGTERM"));
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start all workers
WORKERS.forEach((def) => procs.push(spawnWorker(def)));
