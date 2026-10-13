// Builds an unpacked extension per browser: dist/chrome (MV3) and dist/firefox (MV2).
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const targets = { chrome: "manifest.json", firefox: "manifest.firefox.json" };

await rm(`${root}dist`, { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const out = `${root}dist/${name}`;
  await mkdir(out, { recursive: true });
  await cp(`${root}src`, `${out}/src`, { recursive: true });
  await cp(`${root}icons`, `${out}/icons`, { recursive: true });
  await cp(`${root}${manifest}`, `${out}/manifest.json`);
  await cp(`${root}LICENSE`, `${out}/LICENSE`);
  console.log(`dist/${name}`);
}
