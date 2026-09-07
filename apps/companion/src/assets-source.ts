import { fileURLToPath } from "node:url"

export type Built = {
  readonly web: { readonly script: string; readonly style: string }
  readonly diagnostic: { readonly script: string }
}

const entry = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export async function buildAssets(): Promise<Built> {
  const web = await Bun.build({
    entrypoints: [entry("../../web/src/main.tsx")],
    target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' },
  })
  const diagnostic = await Bun.build({ entrypoints: [entry("./diagnostic-browser.ts")], target: "browser" })
  const script = web.outputs.find((output) => output.kind === "entry-point" && output.path.endsWith(".js"))
  const style = web.outputs.find((output) => output.path.endsWith(".css"))
  if (!web.success || !diagnostic.success || !script || !style || !diagnostic.outputs[0]) throw new Error("Asset build failed")
  return {
    web: { script: await script.text(), style: await style.text() },
    diagnostic: { script: await diagnostic.outputs[0].text() },
  }
}
