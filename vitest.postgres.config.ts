import {defineConfig} from "vitest/config";
import path from "node:path";
export default defineConfig({resolve:{alias:{"@":path.resolve("src")}},test:{include:["tests/postgres/**/*.test.ts"],setupFiles:["./tests/postgres/setup.ts"],fileParallelism:false,testTimeout:30000,hookTimeout:30000}});
