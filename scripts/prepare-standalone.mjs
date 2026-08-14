import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = resolve(root, ".next/standalone");

await access(resolve(standalone, "server.js"));

async function replaceDirectory(source, destination) {
  if (!destination.startsWith(`${standalone}/`)) {
    throw new Error(`Refusing to replace a directory outside standalone output: ${destination}`);
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

await replaceDirectory(resolve(root, ".next/static"), resolve(standalone, ".next/static"));
await replaceDirectory(resolve(root, "public"), resolve(standalone, "public"));
