/** Constantes e utilitários compartilhados pela API e pelas rotas. */
import { PerfilUsuario, PrismaClient } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Autenticacao, SessaoCriada, UsuarioLogado } from '../auth/auth.js';
import { Config, TEMPOS } from '../config.js';
import { EnviarEmail } from '../email/email.js';
import { Cripto } from '../seguranca/cripto.js';

export const PREFIXO = '/api/v1';

/**
 * - publico: sem login (login e health check)
 * - pre-mfa: depois da senha, antes do código MFA
 * - refresh: renovação da sessão (usa o cookie de refresh)
 * - sessao: logado com MFA, mesmo que ainda precise trocar a senha
 * - lista de perfis: logado com MFA, senha já trocada e perfil na lista
 */
export type Acesso = 'publico' | 'pre-mfa' | 'refresh' | 'sessao' | PerfilUsuario[];

declare module 'fastify' {
  interface FastifyContextConfig {
    acesso?: Acesso;
  }
  interface FastifyInstance {
    /** Todas as rotas da API com o acesso exigido (usado nos testes de segurança) */
    inventarioRotas: { metodo: string; url: string; acesso: unknown }[];
  }
  interface FastifyRequest {
    logado?: UsuarioLogado;
  }
}

export const TODOS: PerfilUsuario[] = ['ADMIN', 'OPERADOR', 'VISUALIZADOR'];
export const EDITORES: PerfilUsuario[] = ['ADMIN', 'OPERADOR'];
export const SO_ADMIN: PerfilUsuario[] = ['ADMIN'];

export const COOKIES = {
  acesso: 'ameta_acesso',
  refresh: 'ameta_refresh',
  preMfa: 'ameta_pre_mfa',
  csrf: 'ameta_csrf',
} as const;
export const CABECALHO_CSRF = 'x-csrf-token';

export interface ContextoRotas {
  prisma: PrismaClient;
  cripto: Cripto;
  auth: Autenticacao;
  config: Config;
  enviarEmail: EnviarEmail;
}

/** IP e navegador de quem fez a requisição, para auditoria. */
export function origem(req: FastifyRequest) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] ?? null };
}

/** Contexto de auditoria das operações de dados. */
export function contexto(req: FastifyRequest) {
  return { usuarioId: req.logado?.usuario.id ?? null, ip: req.ip };
}

function opcoesCookie(config: Config, caminho: string, maxAgeSeg: number, httpOnly = true) {
  return { httpOnly, secure: config.COOKIE_SEGURO, sameSite: 'strict' as const, path: caminho, maxAge: maxAgeSeg };
}

export function gravarCookiesSessao(reply: FastifyReply, config: Config, s: SessaoCriada) {
  reply
    .setCookie(COOKIES.acesso, s.acesso, opcoesCookie(config, PREFIXO, TEMPOS.acessoSeg))
    .setCookie(COOKIES.refresh, s.refresh, opcoesCookie(config, `${PREFIXO}/auth`, TEMPOS.sessaoMaxMs / 1000))
    .setCookie(COOKIES.csrf, s.csrf, opcoesCookie(config, '/', TEMPOS.sessaoMaxMs / 1000, false))
    .clearCookie(COOKIES.preMfa, { path: `${PREFIXO}/auth` });
}

export function gravarCookiesPreMfa(reply: FastifyReply, config: Config, token: string, csrf: string) {
  reply
    .setCookie(COOKIES.preMfa, token, opcoesCookie(config, `${PREFIXO}/auth`, TEMPOS.preMfaSeg))
    .setCookie(COOKIES.csrf, csrf, opcoesCookie(config, '/', TEMPOS.preMfaSeg, false));
}

export function limparCookies(reply: FastifyReply) {
  reply
    .clearCookie(COOKIES.acesso, { path: PREFIXO })
    .clearCookie(COOKIES.refresh, { path: `${PREFIXO}/auth` })
    .clearCookie(COOKIES.preMfa, { path: `${PREFIXO}/auth` })
    .clearCookie(COOKIES.csrf, { path: '/' });
}
