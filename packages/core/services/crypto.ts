import { Context, Effect, Layer } from "effect";
import { encrypt, decrypt, getSecretKey } from "../crypto";

export class CryptoService extends Context.Tag("CryptoService")<
  CryptoService,
  {
    readonly encrypt: (text: string) => Effect.Effect<string>;
    readonly decrypt: (encryptedText: string) => Effect.Effect<string>;
  }
>() {}

export const CryptoServiceLive = Layer.sync(CryptoService, () => {
  const key = process.env.ENCRYPTION_KEY;
  const secretKey = getSecretKey(key);
  return CryptoService.of({
    encrypt: (text) => Effect.sync(() => encrypt(text, secretKey)),
    decrypt: (encryptedText) => Effect.sync(() => decrypt(encryptedText, secretKey)),
  });
});
