import { Schema } from "effect"

export class OperationError extends Error {
  constructor(readonly status: number) { super("Remote operation failed"); this.name = "OperationError" }
}

const Text = Schema.String
const ID = (prefix: string) => Text.check(Schema.isPattern(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`)))
const Location = Schema.Struct({ directory: Text, workspaceID: Schema.optional(Text) })
const Model = Schema.Struct({ id: Text, providerID: Text, variant: Schema.optional(Text) })
const Delivery = Schema.optional(Schema.Literals(["steer", "queue"]))
const File = Schema.Struct({
  uri: Text.check(Schema.isPattern(/^data:(text\/plain|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/]*={0,2}$/)),
  name: Schema.optional(Text.check(Schema.isMaxLength(255))),
})
const mutations: ReadonlyArray<readonly [RegExp, Schema.ConstraintDecoder<unknown>]> = [
  [/^\/api\/session$/, Schema.Struct({ id: Schema.optional(ID("ses")), title: Schema.optional(Text), agent: Schema.optional(Text), model: Schema.optional(Model), location: Schema.optional(Location) })],
  [/^\/api\/session\/ses_[A-Za-z0-9_-]+\/prompt$/, Schema.Struct({ id: ID("msg"), text: Text, files: Schema.optional(Schema.Array(File).check(Schema.isMaxLength(4))), delivery: Delivery })],
  [/^\/api\/session\/ses_[A-Za-z0-9_-]+\/move$/, Schema.Struct({ ...Location.fields, delivery: Delivery })],
  [/^\/api\/session\/ses_[A-Za-z0-9_-]+\/agent$/, Schema.Struct({ agent: Text })],
  [/^\/api\/session\/ses_[A-Za-z0-9_-]+\/model$/, Schema.Struct({ model: Model })],
  [/^\/api\/session\/ses_[A-Za-z0-9_-]+\/permission\/per_[A-Za-z0-9_-]+\/reply$/, Schema.Struct({ reply: Schema.Literals(["once", "always", "reject"]), message: Schema.optional(Text) })],
  [/^\/api\/session\/ses_[A-Za-z0-9_-]+\/form\/frm_[A-Za-z0-9_-]+\/reply$/, Schema.Struct({ answer: Schema.Record(Text, Schema.Union([Text, Schema.Finite, Schema.Boolean, Schema.Array(Text)])) })],
]
const emptyMutation = /^\/api\/session\/ses_[A-Za-z0-9_-]+\/(interrupt|form\/frm_[A-Za-z0-9_-]+\/cancel)$/
const reads = [
  /^\/api\/(location|session|session\/active|remote\/(agent|model))$/,
  /^\/api\/session\/ses_[A-Za-z0-9_-]+$/,
  /^\/api\/session\/ses_[A-Za-z0-9_-]+\/(message|inbox|permission|form)$/,
  /^\/api\/session\/ses_[A-Za-z0-9_-]+\/message\/msg_[A-Za-z0-9_-]+$/,
  /^\/api\/session\/ses_[A-Za-z0-9_-]+\/permission\/per_[A-Za-z0-9_-]+$/,
  /^\/api\/session\/ses_[A-Za-z0-9_-]+\/form\/frm_[A-Za-z0-9_-]+(\/state)?$/,
]
const Request = Schema.Struct({
  method: Schema.Literals(["GET", "POST"]),
  path: Text,
  query: Schema.optional(Schema.Record(Text, Text)),
  body: Schema.optional(Schema.Unknown),
})
export type Operation = typeof Request.Type

export function operation(value: unknown): Operation {
  try {
    const input = Schema.decodeUnknownSync(Request, { onExcessProperty: "error" })(value)
    const fields = input.path === "/api/session" && input.method === "GET"
      ? ["workspace", "limit", "order", "search", "parentID", "directory", "project", "subpath", "cursor"]
      : /^\/api\/(location|remote\/(agent|model))$/.test(input.path)
        ? ["location[directory]", "location[workspace]"]
        : /^\/api\/session\/ses_[A-Za-z0-9_-]+\/message$/.test(input.path)
          ? ["limit", "order", "cursor"] : input.path.endsWith("/interrupt") ? ["continue"] : []
    if (Object.keys(input.query ?? {}).some((key) => !fields.includes(key))) throw new OperationError(400)
    if (input.method === "GET") {
      if (!reads.some((pattern) => pattern.test(input.path)) || input.body !== undefined) throw new OperationError(400)
    } else if (emptyMutation.test(input.path)) {
      if (!Schema.is(Schema.Record(Text, Schema.Unknown))(input.body) || Object.keys(input.body).length) throw new OperationError(400)
    } else {
      const entry = mutations.find(([pattern]) => pattern.test(input.path))
      if (!entry) throw new OperationError(400)
      Schema.decodeUnknownSync(entry[1], { onExcessProperty: "error" })(input.body)
    }
    return input
  } catch { throw new OperationError(400) }
}
