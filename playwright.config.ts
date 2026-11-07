import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./web/tests",
  // Software WebGL avoids a headless Windows GPU clipping artifact in map captures.
  use: { baseURL: "http://127.0.0.1:5173", browserName: "chromium", launchOptions:{args:['--use-angle=swiftshader']} },
  timeout: 90000,
});
