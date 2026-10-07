/**
 * Criptografia de campo (AES-256-GCM) para nome, e-mail e segredo MFA, e HMAC para busca.
 * Formato gravado: versão (1 byte) | IV (12) | tag (16) | texto cifrado.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSAO = 1;

export class Cripto {
  private readonly chave: Buffer;
  private readonly chaveHmac: Buffer;

  constructor(chaveBase64: string, chaveHmacBase64: string) {
    this.chave = Buffer.from(chaveBase64, 'base64');
    this.chaveHmac = Buffer.from(chaveHmacBase64, 'base64');
    if (this.chave.length !== 32 || this.chaveHmac.length !== 32) throw new Error('Chaves devem ter 32 bytes');
  }

  cifrar(texto: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.chave, iv);
    const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return new Uint8Array(Buffer.concat([Buffer.from([VERSAO]), iv, c.getAuthTag(), dados]));
  }

  decifrar(blob: Uint8Array): string {
    const b = Buffer.from(blob);
    if (b[0] !== VERSAO) throw new Error('Formato de dado cifrado desconhecido');
    const d = createDecipheriv('aes-256-gcm', this.chave, b.subarray(1, 13));
    d.setAuthTag(b.subarray(13, 29));
    return Buffer.concat([d.update(b.subarray(29)), d.final()]).toString('utf8');
  }

  hmac(texto: string): string {
    return createHmac('sha256', this.chaveHmac).update(texto, 'utf8').digest('hex');
  }

  hashEmail(email: string): string {
    return this.hmac(`email:${normalizarEmail(email)}`);
  }
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Token aleatório para refresh, CSRF e códigos. */
export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash de tokens de alta entropia (refresh token). Não serve para senhas. */
export function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

export function iguaisSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
