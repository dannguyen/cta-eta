import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

const TRAIN_API_URL = "https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx";
const BUS_API_URL =
  "https://www.ctabustracker.com/bustime/api/v3/getpredictions";

function parseKeyFile(raw) {
  const keys = {
    train: "",
    bus: "",
  };

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }

    const key = match[1].toLowerCase();
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    if (key === "train" || key === "train_api_key") {
      keys.train = value;
    }
    if (key === "bus" || key === "bus_api_key") {
      keys.bus = value;
    }
  }

  return keys;
}

function loadDevKeys() {
  const keyPath = path.resolve(process.cwd(), "static/keys.toml");
  if (!fs.existsSync(keyPath)) {
    return { train: "", bus: "" };
  }
  return parseKeyFile(fs.readFileSync(keyPath, "utf8"));
}

function ctaDevApiMiddleware() {
  return {
    name: "cta-dev-api-middleware",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const reqUrl = req.url || "";
        if (
          !reqUrl.startsWith("/api/train") &&
          !reqUrl.startsWith("/api/bus")
        ) {
          next();
          return;
        }

        const keys = loadDevKeys();
        const origin = `http://${req.headers.host || "localhost"}`;
        const incomingUrl = new URL(reqUrl, origin);
        const isTrain = incomingUrl.pathname === "/api/train";
        const isBus = incomingUrl.pathname === "/api/bus";

        if (!isTrain && !isBus) {
          next();
          return;
        }

        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        const key = isTrain ? keys.train : keys.bus;
        if (!key) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              error: `Missing ${isTrain ? "TRAIN_API_KEY" : "BUS_API_KEY"} in static/keys.toml for local dev.`,
            }),
          );
          return;
        }

        const upstreamUrl = new URL(isTrain ? TRAIN_API_URL : BUS_API_URL);
        for (const [param, value] of incomingUrl.searchParams.entries()) {
          upstreamUrl.searchParams.append(param, value);
        }
        if (isTrain) {
          upstreamUrl.searchParams.set("outputType", "JSON");
        } else {
          upstreamUrl.searchParams.set("format", "json");
        }
        upstreamUrl.searchParams.set("key", key);

        try {
          const upstream = await fetch(upstreamUrl.toString(), {
            headers: {
              Accept: "application/json",
            },
          });
          const body = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader(
            "content-type",
            upstream.headers.get("content-type") || "application/json",
          );
          res.end(body);
        } catch {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              error: `Failed to reach CTA ${isTrain ? "train" : "bus"} API.`,
            }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [sveltekit(), ctaDevApiMiddleware()],
});
