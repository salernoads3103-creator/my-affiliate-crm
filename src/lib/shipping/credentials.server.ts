const ENCRYPTION_KEY_ENV = "NOVA_POSHTA_CREDENTIALS_ENCRYPTION_KEY";

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value);
    const decoded = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      decoded[index] = binary.charCodeAt(index);
    }
    return decoded;
  } catch {
    throw new Error(`${ENCRYPTION_KEY_ENV} must be base64 encoded`);
  }
}

function encodeBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const encoded = process.env[ENCRYPTION_KEY_ENV];
  if (!encoded) throw new Error(`${ENCRYPTION_KEY_ENV} is required`);
  const raw = decodeBase64(encoded);
  if (raw.byteLength !== 32) throw new Error(`${ENCRYPTION_KEY_ENV} must decode to 32 bytes`);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptNovaPoshtaApiKey(apiKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await getEncryptionKey();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(apiKey),
  );
  return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(encrypted))}`;
}

export async function decryptNovaPoshtaApiKey(ciphertext: string): Promise<string> {
  const [encodedIv, encodedData, extra] = ciphertext.split(".");
  if (!encodedIv || !encodedData || extra !== undefined)
    throw new Error("Invalid credential record");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(encodedIv) },
    await getEncryptionKey(),
    decodeBase64(encodedData),
  );
  return new TextDecoder().decode(plaintext);
}
