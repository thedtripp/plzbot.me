#!/usr/bin/env node
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: [path.join(repoRoot, "src", "client", "index.ts")],
  bundle: true,
  outfile: path.join(repoRoot, "public", "collector.js"),
  format: "iife",
  target: ["es2020"],
  sourcemap: true,
  minify: process.env.NODE_ENV === "production",
  logLevel: "info",
});
