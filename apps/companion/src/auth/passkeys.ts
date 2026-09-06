import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server"
import { decodeClientDataJSON } from "@simplewebauthn/server/helpers"
import { Effect } from "effect"
import { Challenges } from "./challenges"

type Ceremony = {
  readonly kind: "registration" | "authentication"
  readonly challenge: string
  readonly userID: string
  readonly credentialID?: string
}

export type Passkey = {
  readonly userID: string
  readonly credential: WebAuthnCredential
}

export type PasskeyConfig = {
  readonly origin: string
  readonly challengeLifetimeMs: number
  readonly challengeCapacity: number
}

export class PasskeyError extends Error {
  constructor() {
    super("Passkey ceremony failed")
    this.name = "PasskeyError"
  }
}

export function makePasskeys(config: PasskeyConfig, now?: () => number) {
  const origin = new URL(config.origin)
  if (origin.protocol !== "https:" || origin.origin !== config.origin || origin.username || origin.password) {
    throw new Error("Passkeys require an explicit HTTPS origin without a path or credentials")
  }
  const challenges = new Challenges<Ceremony>(config.challengeLifetimeMs, config.challengeCapacity, now)
  let generation = 0
  const run = <T>(operation: () => Promise<T>) => Effect.tryPromise({ try: operation, catch: () => new PasskeyError() })

  function sameOrigin(clientDataJSON: string): void {
    const data = decodeClientDataJSON(clientDataJSON)
    if (
      data.origin !== config.origin ||
      (data.crossOrigin !== undefined && data.crossOrigin !== false) ||
      data.topOrigin !== undefined
    ) {
      throw new PasskeyError()
    }
  }

  return {
    registrationOptions(binding: string, userID: Uint8Array) {
      return run(async () => {
        const current = generation
        const options = await generateRegistrationOptions({
          rpName: "Redsun Remote Control",
          rpID: origin.hostname,
          userName: "Owner",
          userID: new Uint8Array(userID),
          attestationType: "none",
          authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        })
        if (current !== generation) throw new PasskeyError()
        const ceremonyID = challenges.issue(binding, {
          kind: "registration",
          challenge: options.challenge,
          userID: options.user.id,
        })
        return { ceremonyID, options }
      })
    },

    verifyRegistration(binding: string, ceremonyID: string, response: RegistrationResponseJSON) {
      return run(async () => {
        const current = generation
        const ceremony = challenges.take(ceremonyID, binding)
        if (ceremony.kind !== "registration") throw new PasskeyError()
        sameOrigin(response.response.clientDataJSON)
        const result = await verifyRegistrationResponse({
          response,
          expectedChallenge: ceremony.challenge,
          expectedOrigin: config.origin,
          expectedRPID: origin.hostname,
          requireUserPresence: true,
          requireUserVerification: true,
        })
        if (!result.verified || !result.registrationInfo || current !== generation) throw new PasskeyError()
        if (result.registrationInfo.credential.id !== response.id) throw new PasskeyError()
        return { userID: ceremony.userID, credential: result.registrationInfo.credential } satisfies Passkey
      })
    },

    authenticationOptions(binding: string, passkey: Passkey) {
      return run(async () => {
        const current = generation
        const options = await generateAuthenticationOptions({
          rpID: origin.hostname,
          allowCredentials: [passkey.credential],
          userVerification: "required",
        })
        if (current !== generation) throw new PasskeyError()
        const ceremonyID = challenges.issue(binding, {
          kind: "authentication",
          challenge: options.challenge,
          userID: passkey.userID,
          credentialID: passkey.credential.id,
        })
        return { ceremonyID, options }
      })
    },

    verifyAuthentication(binding: string, ceremonyID: string, response: AuthenticationResponseJSON, passkey: Passkey) {
      return run(async () => {
        const current = generation
        const ceremony = challenges.take(ceremonyID, binding)
        if (
          ceremony.kind !== "authentication" ||
          ceremony.credentialID !== passkey.credential.id ||
          ceremony.userID !== passkey.userID ||
          response.id !== passkey.credential.id ||
          (response.response.userHandle != null && response.response.userHandle !== passkey.userID)
        ) throw new PasskeyError()
        sameOrigin(response.response.clientDataJSON)
        const result = await verifyAuthenticationResponse({
          response,
          credential: passkey.credential,
          expectedChallenge: ceremony.challenge,
          expectedOrigin: config.origin,
          expectedRPID: origin.hostname,
          requireUserVerification: true,
        })
        if (!result.verified || current !== generation) throw new PasskeyError()
        return {
          userID: passkey.userID,
          credential: { ...passkey.credential, counter: result.authenticationInfo.newCounter },
        } satisfies Passkey
      })
    },

    invalidate: Effect.sync(() => {
      generation += 1
      challenges.clear()
    }),
  }
}
