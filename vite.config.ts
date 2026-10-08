import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import vercel from "./vercel.json" with { type: "json" };
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "production-security-preview",
      configurePreviewServer(server) {
        server.middlewares.use((_req, res, next) => {
          for (const h of vercel.headers[0].headers)
            res.setHeader(h.key, h.value);
          next();
        });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  worker: { format: "es" },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
  build: { sourcemap: false },
});
