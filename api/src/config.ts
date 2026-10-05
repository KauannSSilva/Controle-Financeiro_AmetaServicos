import { z } from 'zod';

const chave32 = (nome: string) =>
  z.string({ error: `${nome} não definida. Rode npm run api:chaves para gerar.` })
    .refine((v) => Buffer.from(v, 'base64').length === 32, `${nome} deve ter 32 bytes em base64. Rode npm run api:chaves.`);

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORTA: z.coerce.number().int().default(3000),
  /** Endereço do front (CORS). Na Fase 3 é o Vite; em produção, o domínio real. */
  ORIGEM_FRONT: z.string().url().default('http://localhost:5173'),
  /** Assina o token de acesso (HS256). */
  JWT_SEGREDO: chave32('JWT_SEGREDO'),
  /** AES-256-GCM dos dados pessoais (nome, e-mail, segredo MFA). */
  CHAVE_CRIPTOGRAFIA: chave32('CHAVE_CRIPTOGRAFIA'),
  /** HMAC do e-mail (busca) e dos códigos de recuperação. */
  CHAVE_HMAC: chave32('CHAVE_HMAC'),
  /** Cookies só por HTTPS. Navegadores aceitam em http://localhost, então fica ligado também no local. */
  COOKIE_SEGURO: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** Envio dos convites. O padrão é o Mailpit local (docker compose), que só mostra os e-mails em http://localhost:8025. */
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORTA: z.coerce.number().int().default(1025),
  /** true = TLS direto (porta 465). Na porta 587 o TLS é negociado sozinho (STARTTLS). */
  SMTP_SEGURO: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SMTP_USUARIO: z.string().optional(),
  SMTP_SENHA: z.string().optional(),
  EMAIL_REMETENTE: z.string().default('Controle Financeiro Ameta <nao-responda@ameta.com.br>'),
  /** Endereço do site usado no link do convite. Sem valor, usa ORIGEM_FRONT. */
  URL_SITE: z.string().url().optional(),
});

export type Config = z.infer<typeof esquema>;

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) {
    throw new Error(`Configuração inválida no .env:\n${r.error.issues.map((i) => `- ${i.message}`).join('\n')}`);
  }
  return r.data;
}

/** Tempos de sessão e de bloqueio (seção 5 e 7 da especificação). */
export const TEMPOS = {
  /** Token de acesso curto; o front renova com o refresh token */
  acessoSeg: 15 * 60,
  /** Etapa entre a senha e o código MFA */
  preMfaSeg: 5 * 60,
  /** Sessão termina após 30 min sem uso */
  inatividadeMs: 30 * 60 * 1000,
  /** Duração máxima de uma sessão, mesmo em uso */
  sessaoMaxMs: 12 * 60 * 60 * 1000,
  /** 5 falhas em 15 min bloqueiam; cada novo bloqueio dobra o tempo (15, 30, 60 min...) */
  maxFalhas: 5,
  janelaFalhasMs: 15 * 60 * 1000,
  bloqueioBaseMs: 15 * 60 * 1000,
  bloqueioMaxMs: 24 * 60 * 60 * 1000,
  /** Prazo para aceitar o convite enviado por e-mail */
  conviteMs: 72 * 60 * 60 * 1000,
};
