import { defineConfig } from "vitest/config";

// The database-backed test files share one throwaway database and TRUNCATE it, so test files run one at a time.
export default defineConfig({ test: { fileParallelism: false } });
