import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/datasciencecoursera/" : "/",
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      process: "process/browser",
    },
  },
  optimizeDeps: {
    include: ["ethers"],
  },
}));
