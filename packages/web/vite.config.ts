import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    port: 3000,
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
