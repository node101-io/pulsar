import { DB } from "./db.js";
import {
    incrementFailCount,
    fetchBlockRange,
    fetchLastStoredBlock,
} from "./utils.js";

export { DB, incrementFailCount, fetchBlockRange, fetchLastStoredBlock };
