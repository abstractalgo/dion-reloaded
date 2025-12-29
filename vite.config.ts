import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate Monaco Editor into its own chunk
          monaco: ["monaco-editor"],
          // Separate TypeScript into its own chunk
          typescript: ["typescript"],
        },
      },
    },
  },
});
