/** Hash de senha com Argon2id e política de senha forte. */
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { ErroRegra } from '../erros.js';

// Parâmetros mínimos recomendados pela OWASP para Argon2id (19 MiB, 2 iterações)
const OPCOES = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

/**
 * Acentos podem chegar em duas formas (ex.: "ã" pronto ou "a" + "~", comum em teclados ABNT2 e no terminal).
 * Normalizar (NFC) faz a mesma senha digitada no terminal e no navegador dar o mesmo hash.
 */
const normalizar = (senha: string) => senha.normalize('NFC');

export function hashSenha(senha: string): Promise<string> {
  return hash(normalizar(senha), OPCOES);
}

export async function conferirSenha(hashGravado: string, senha: string): Promise<boolean> {
  try {
    return (await verify(hashGravado, normalizar(senha))) || (await verify(hashGravado, senha));
  } catch {
    return false;
  }
}

/** Hash de uma senha qualquer, usado para gastar o mesmo tempo quando o e-mail não existe. */
let hashFalso: Promise<string> | undefined;
export function hashParaTempoConstante(): Promise<string> {
  hashFalso ??= hashSenha('senha-que-ninguem-usa-para-igualar-o-tempo');
  return hashFalso;
}

// Senhas comuns e padrões de vazamentos conhecidos. A Fase 4 amplia com uma lista maior.
const COMUNS = [
  'senha', 'password', 'qwerty', 'abc123', 'admin', 'administrador', 'ameta', 'ametaservicos', 'brasil',
  'iloveyou', 'welcome', 'letmein', 'trocar', 'mudar', 'teste', 'master', 'dragon', 'monkey', 'football',
  'futebol', 'flamengo', 'corinthians', 'palmeiras', 'saopaulo', 'vasco', 'gremio', 'cruzeiro', 'santos',
  'internacional', 'botafogo', 'fluminense', 'princesa', 'jesus', 'deus', 'amor', 'familia', 'claro', 'vivo',
];

export function validarPoliticaSenha(senha: string, contexto: { email?: string; nome?: string } = {}) {
  if (senha.length < 12) throw new ErroRegra('A senha precisa ter pelo menos 12 caracteres');
  if (senha.length > 128) throw new ErroRegra('A senha pode ter no máximo 128 caracteres');
  const simples = senha.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  if (/^(.)\1+$/.test(simples) || /^(0123456789|1234567890|123456789012)/.test(simples)) {
    throw new ErroRegra('Senha muito fácil de adivinhar');
  }
  const semNumeros = simples.replace(/[0-9]/g, '');
  if (COMUNS.some((c) => semNumeros === c || simples === c || (simples.startsWith(c) && /^[0-9]*$/.test(simples.slice(c.length))))) {
    throw new ErroRegra('Esta senha é comum demais. Escolha outra.');
  }
  if (contexto.email && senha.toLowerCase().includes(contexto.email.toLowerCase())) {
    throw new ErroRegra('A senha não pode conter o seu e-mail');
  }
  const usuarioEmail = contexto.email?.split('@')[0]?.toLowerCase();
  if (usuarioEmail && usuarioEmail.length >= 4 && simples.includes(usuarioEmail.replace(/[^a-z0-9]/g, ''))) {
    throw new ErroRegra('A senha não pode conter o seu e-mail');
  }
}
