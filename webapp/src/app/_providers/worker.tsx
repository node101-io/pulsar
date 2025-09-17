"use client";

import React, { createContext, useContext, useRef, ReactNode, useEffect, useState } from "react";
import WorkerClient from "@/lib/workerClient";
import { BRIDGE_ADDRESS, MINA_RPC_URL } from "@/lib/constants";

interface WorkerContextType {
    worker: WorkerClient | null;
    isInitialized: boolean;
    isInitializing: boolean;
    workerReady: boolean;
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
    const initializationRef = useRef<Promise<void> | null>(null);

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

        const initPromise = (async () => {
            try {
                await workerRef.current!.setActiveInstance({ url: MINA_RPC_URL });
                console.log("Mina instance set to", MINA_RPC_URL);
                await workerRef.current!.compile({ contractAddress: BRIDGE_ADDRESS });
                setIsInitialized(true);
            } catch (error) {
                console.error("Worker initialization failed:", error);
                throw error;
            } finally {
                setIsInitializing(false);
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
    };
}
