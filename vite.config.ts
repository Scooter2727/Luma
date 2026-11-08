import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // The root .env holds backend-only keys. Keeping Vite out of it means it never exposes them and
  // does not restart (reloading the page) when Settings saves keys there.
  envDir: "web",
  server: {
    host: "0.0.0.0",
    // Vercel dev owns /api routing. This proxy is only for standalone npm run dev.
    proxy:
      process.env.VERCEL === "1"
        ? undefined
        : {
            "/api": process.env.LUMA_LOCAL_API_URL || "http://127.0.0.1:8000",
          },
  },
  build: { outDir: "dist" },
});
