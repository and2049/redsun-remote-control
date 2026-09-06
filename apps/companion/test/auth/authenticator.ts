import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server"
import { isoCBOR } from "@simplewebauthn/server/helpers"

type Input = {
  readonly challenge: string
  readonly origin: string
  readonly rpID?: string
  readonly flags?: number
  readonly counter?: number
  readonly crossOrigin?: boolean
  readonly userHandle?: string
}

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest()
const base64 = (value: Uint8Array) => Buffer.from(value).toString("base64url")

export function authenticator(algorithm: "ES256" | "RS256" | "Ed25519" = "ES256") {
  const { publicKey, privateKey } = algorithm === "ES256"
    ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    : algorithm === "RS256"
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : generateKeyPairSync("ed25519")
  const jwk = publicKey.export({ format: "jwk" })
  const coordinate = (value: string | undefined): Uint8Array => {
    if (!value) throw new Error("Missing fixture public key coordinate")
    return new Uint8Array(Buffer.from(value, "base64url"))
  }
  const key = new Map<number, number | Uint8Array>()
  if (algorithm === "ES256") {
    key.set(1, 2).set(3, -7).set(-1, 1).set(-2, coordinate(jwk.x)).set(-3, coordinate(jwk.y))
  } else if (algorithm === "RS256") {
    key.set(1, 3).set(3, -257).set(-1, coordinate(jwk.n)).set(-2, coordinate(jwk.e))
  } else {
    key.set(1, 1).set(3, -8).set(-1, 6).set(-2, coordinate(jwk.x))
  }
  const cose = isoCBOR.encode(key)
  const id = randomBytes(32)

  function clientData(input: Input, type: string): Buffer {
    return Buffer.from(JSON.stringify({
      type,
      challenge: input.challenge,
      origin: input.origin,
      crossOrigin: input.crossOrigin ?? false,
    }))
  }

  function authData(input: Input, registration: boolean): Buffer {
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(input.counter ?? 0)
    const header = Buffer.concat([
      hash(input.rpID ?? new URL(input.origin).hostname),
      Buffer.from([(input.flags ?? 5) | (registration ? 64 : 0)]),
      counter,
    ])
    if (!registration) return header
    const length = Buffer.alloc(2)
    length.writeUInt16BE(id.length)
    return Buffer.concat([header, Buffer.alloc(16), length, id, cose])
  }

  return {
    registration(input: Input): RegistrationResponseJSON {
      const attestation = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, never>>([
        ["fmt", "none"],
        ["authData", new Uint8Array(authData(input, true))],
        ["attStmt", new Map<string, never>()],
      ]))
      return {
        id: base64(id),
        rawId: base64(id),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: base64(clientData(input, "webauthn.create")),
          attestationObject: base64(attestation),
        },
      }
    },

    authentication(input: Input): AuthenticationResponseJSON {
      const data = clientData(input, "webauthn.get")
      const auth = authData(input, false)
      return {
        id: base64(id),
        rawId: base64(id),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: base64(data),
          authenticatorData: base64(auth),
          signature: base64(sign(algorithm === "Ed25519" ? null : "sha256", Buffer.concat([auth, hash(data)]), privateKey)),
          ...(input.userHandle === undefined ? {} : { userHandle: input.userHandle }),
        },
      }
    },
  }
}
