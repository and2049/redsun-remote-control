import { Effect } from "effect"
import { buildAssets } from "./assets-source"

export const embedded = Effect.tryPromise({
  try: () => import("./generated/assets").then((module) => module.assets),
  catch: () => new Error("Embedded assets unavailable"),
}).pipe(Effect.catch(() => Effect.tryPromise({ try: buildAssets, catch: () => new Error("Asset build failed") })))
