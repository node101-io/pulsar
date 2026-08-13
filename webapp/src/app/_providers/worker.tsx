"use client";

import React, { createContext, useContext, useRef, ReactNode, useEffect, useState } from "react";
import WorkerClient from "@/lib/workerClient";
import { BRIDGE_ADDRESS, MINA_RPC_URL } from "@/lib/constants";

interface WorkerContextType {
    worker: WorkerClient | null;
    isInitialized: boolean;
    isInitializing: boolean;
    workerReady: boolean;
    compiledCount: number;
    totalPrograms: number;
    initializeWorker: () => Promise<void>;
}

const WorkerContext = createContext<WorkerContextType | null>(null);

interface WorkerProviderProps {
    children: ReactNode;
}

export function WorkerProvider({ children }: WorkerProviderProps) {
    const workerRef = useRef<WorkerClient | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [isInitializing, setIsInitializing] = useState(false);
    const [workerReady, setWorkerReady] = useState(false);
    const [compiledCount, setCompiledCount] = useState(0);
    const [totalPrograms, setTotalPrograms] = useState(0);
    const initializationRef = useRef<Promise<void> | null>(null);
    const pollIntervalRef = useRef<number | null>(null);

    useEffect(() => {
        if (!workerRef.current && typeof window !== "undefined") {
            try {
                workerRef.current = new WorkerClient();
                setWorkerReady(true);
            } catch (error) {
                console.error("Failed to create WorkerClient:", error);
            }
        }
    }, []);

    const initializeWorker = async () => {
        if (isInitialized || isInitializing) {
            return initializationRef.current || Promise.resolve();
        }

        if (!workerRef.current) {
            throw new Error("Worker is not available. Make sure you're running in the browser.");
        }

        setIsInitializing(true);
        setCompiledCount(0);
        setTotalPrograms(0);

        const initPromise = (async () => {
            try {
                await workerRef.current!.setActiveInstance({ url: MINA_RPC_URL });
                console.log("Mina instance set to", MINA_RPC_URL);
                // start polling worker state for compile progress
                if (pollIntervalRef.current) {
                    window.clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                }
                pollIntervalRef.current = window.setInterval(async () => {
                    try {
                        const st = await workerRef.current!.getState();
                        if (typeof (st as any).compiledCount === "number") {
                            setCompiledCount((st as any).compiledCount);
                        }
                        if (typeof (st as any).totalPrograms === "number") {
                            setTotalPrograms((st as any).totalPrograms);
                        }
                        if ((st as any).status === "ready") {
                            if (pollIntervalRef.current) {
                                window.clearInterval(pollIntervalRef.current);
                                pollIntervalRef.current = null;
                            }
                        }
                    } catch (e) {
                        // ignore transient polling errors
                    }
                }, 300);
                await workerRef.current!.compile({ contractAddress: BRIDGE_ADDRESS });
                setIsInitialized(true);
            } catch (error) {
                console.error("Worker initialization failed:", error);
                throw error;
            } finally {
                setIsInitializing(false);
                if (pollIntervalRef.current) {
                    window.clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                }
                initializationRef.current = null;
            }
        })();

        initializationRef.current = initPromise;
        return initPromise;
    };

    return (
        <WorkerContext.Provider
            value={{
                worker: workerRef.current,
                isInitialized,
                isInitializing,
                workerReady,
                compiledCount,
                totalPrograms,
                initializeWorker,
            }}
        >
            {children}
        </WorkerContext.Provider>
    );
}

export function useWorker(): WorkerClient | null {
    const context = useContext(WorkerContext);

    if (!context) {
        throw new Error("useWorker must be used within a WorkerProvider");
    }

    return context.worker;
}

export function useWorkerInit() {
    const context = useContext(WorkerContext);

    if (!context) {
        throw new Error("useWorkerInit must be used within a WorkerProvider");
    }

    return {
        isInitialized: context.isInitialized,
        isInitializing: context.isInitializing,
        workerReady: context.workerReady,
        initializeWorker: context.initializeWorker,
        compiledCount: context.compiledCount,
        totalPrograms: context.totalPrograms,
    };
}
