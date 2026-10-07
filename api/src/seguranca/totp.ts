/** MFA por TOTP (RFC 6238): 6 dígitos, 30 s, tolerância de ±1 janela e bloqueio de reuso. */
import { generate, generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { randomInt } from 'node:crypto';

export const EMISSOR_MFA = 'Ameta Serviços';

export function novoSegredoMfa(): string {
  return generateSecret();
}

export function uriMfa(segredo: string, email: string): string {
  return generateURI({ issuer: EMISSOR_MFA, label: email, secret: segredo });
}

export function qrCodePng(uri: string): Promise<Buffer> {
  return QRCode.toBuffer(uri, { type: 'png', width: 280, margin: 2 });
}

/**
 * Confere o código. Devolve o passo de tempo aceito (para gravar e impedir reuso) ou null.
 * Só aceita passos posteriores a `ultimoPasso`.
 */
export async function conferirCodigoMfa(segredo: string, codigo: string, ultimoPasso?: bigint | null, agora = Date.now()) {
  if (!/^\d{6}$/.test(codigo)) return null;
  const r = await verify({
    secret: segredo, token: codigo, epoch: Math.floor(agora / 1000), epochTolerance: 30,
    afterTimeStep: ultimoPasso == null ? undefined : Number(ultimoPasso),
  });
  return r.valid && 'timeStep' in r ? BigInt(r.timeStep) : null;
}

/** Só para testes e para o guia de uso: gera o código atual. */
export function codigoMfaAtual(segredo: string, agora = Date.now()): Promise<string> {
  return generate({ secret: segredo, epoch: Math.floor(agora / 1000) });
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I para não confundir

/** Código de recuperação no formato XXXXX-XXXXX (50 bits). */
export function novoCodigoRecuperacao(): string {
  const c = Array.from({ length: 10 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

export function normalizarCodigoRecuperacao(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
