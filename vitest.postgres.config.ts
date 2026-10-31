import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["tests/postgres/**/*.test.ts"],setupFiles:["./tests/postgres/setup.ts"],fileParallelism:false,testTimeout:30000,hookTimeout:30000}});
