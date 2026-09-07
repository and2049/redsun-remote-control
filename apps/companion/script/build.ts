import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { buildAssets } from "../src/assets-source"

const at = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

const assets = await buildAssets()
await mkdir(at("../src/generated"), { recursive: true })
await writeFile(at("../src/generated/assets.ts"), `import type { Built } from "../assets-source"\n\nexport const assets: Built = ${JSON.stringify(assets)}\n`)
await rm(at("../dist"), { recursive: true, force: true })
await copyFile(at("../../../LICENSE"), at("../LICENSE"))
const bundle = await Bun.build({
  entrypoints: [at("../src/index.ts")],
  outdir: at("../dist"), target: "bun", format: "esm", packages: "external",
})
if (!bundle.success) {
  for (const log of bundle.logs) console.error(String(log))
  process.exit(1)
}
await writeFile(at("../dist/cli.js"), (await readFile(at("../src/cli.ts"), "utf8")).replace('"./index"', '"./index.js"'))
console.log(bundle.outputs.map((output) => `${output.path} ${output.size}`).join("\n"))
