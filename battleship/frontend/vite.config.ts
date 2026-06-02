import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function battleshipTerminalLogger(): Plugin {
  return {
    name: "battleship-terminal-logger",
    configureServer(server) {
      server.middlewares.use("/__battleship_log", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        let body = "";

        req.on("data", (chunk) => {
          body += chunk;
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body) as {
              time?: string;
              tag?: string;
              data?: unknown;
            };

            const time = payload.time ?? new Date().toISOString();
            const tag = payload.tag ?? "unknown";
            console.log(`[Battleship ${time}] ${tag}`, payload.data ?? {});
          } catch {
            console.log("[Battleship] malformed log payload", body);
          }

          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), battleshipTerminalLogger()],
});
