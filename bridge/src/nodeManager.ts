import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKERS = [
    {
        name: "bridge-main",
        script: join(__dirname, "index.js"),
        color: "\x1b[36m",
    },
    {
        name: "bridge-tx-sender",
        script: join(__dirname, "workers/bridge-tx-sender/index.js"),
        color: "\x1b[33m",
        extraArgs: ["--max-old-space-size=512"],
    },
];

const RESET = "\x1b[0m";
const RESTART_DELAY_MS = 3000;

function prefix(name: string, color: string) {
    return `${color}[${name.padEnd(20)}]${RESET} `;
}

function spawnWorker(def: (typeof WORKERS)[0]) {
    const nodeArgs = [...(def.extraArgs ?? []), def.script];
    const proc = spawn(process.execPath, nodeArgs, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
    });

    const pre = prefix(def.name, def.color);

    proc.stdout!.on("data", (data: Buffer) => {
        data.toString().split("\n").filter(Boolean).forEach((line) => {
            process.stdout.write(pre + line + "\n");
        });
    });

    proc.stderr!.on("data", (data: Buffer) => {
        data.toString().split("\n").filter(Boolean).forEach((line) => {
            process.stderr.write(pre + line + "\n");
        });
    });

    proc.on("exit", (code, signal) => {
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        process.stdout.write(
            `${pre}process exited (${reason}), restarting in ${RESTART_DELAY_MS / 1000}s...\n`,
        );
        setTimeout(() => spawnWorker(def), RESTART_DELAY_MS);
    });

    process.stdout.write(`${pre}started (pid ${proc.pid})\n`);
    return proc;
}

const procs: ReturnType<typeof spawn>[] = [];

function shutdown() {
    process.stdout.write("\nShutting down all bridge workers...\n");
    procs.forEach((p) => p.kill("SIGTERM"));
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

WORKERS.forEach((def) => procs.push(spawnWorker(def)));
