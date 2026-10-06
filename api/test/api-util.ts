/** Apoio dos testes da API: navegador simulado (guarda cookies e manda o token CSRF) e login completo com MFA. */
import { PerfilUsuario, PrismaClient } from '@prisma/client';
import { lerConfig } from '../src/config.js';
import { criarPrisma } from '../src/db.js';
import { App, criarApp } from '../src/http/app.js';
import { Email } from '../src/email/email.js';
import { urlAppTeste } from './ambiente.js';
import { COOKIES, PREFIXO } from '../src/http/comum.js';
import { Cripto } from '../src/seguranca/cripto.js';
import { codigoMfaAtual } from '../src/seguranca/totp.js';
import { criarUsuario } from '../src/usuarios/usuarios.js';

export const SENHA = 'notas da ameta em dia 2026';

/** Caixa de entrada dos testes: os e-mails que a API "enviou" */
export const caixaDeEntrada: Email[] = [];
/** Quando true, o envio falha (simula o SMTP fora do ar) */
export const smtp = { fora: false };

/** Conexão da API nos testes: papel sem privilégio de dono, sujeito ao RLS */
const prismaApp = criarPrisma(urlAppTeste());

/** O prisma recebido (dono do banco) fica para preparar dados; a API usa o papel ameta_app_teste. */
export async function novaApp(_prisma: PrismaClient) {
  return criarApp({
    prisma: prismaApp, config: lerConfig(),
    enviarEmail: async (m) => {
      if (smtp.fora) throw new Error('SMTP fora do ar');
      caixaDeEntrada.push(m);
    },
  });
}

/** Último e-mail recebido por este endereço */
export function ultimoEmail(para: string) {
  const m = caixaDeEntrada.filter((e) => e.para === para).at(-1);
  if (!m) throw new Error(`nenhum e-mail para ${para}`);
  return m;
}

/** Token do link "Aceitar convite" do último convite deste endereço */
export function tokenConvite(para: string) {
  const t = ultimoEmail(para).texto.match(/\/convite#([A-Za-z0-9_-]+)/)?.[1];
  if (!t) throw new Error('convite sem link');
  return t;
}

/** Simula a pessoa clicando no link do e-mail */
export async function aceitarConvite(app: App, para: string) {
  const r = await new Navegador(app).req('POST', 'auth/convite/aceitar', { token: tokenConvite(para) });
  if (r.statusCode !== 200) throw new Error(`aceitar convite ${r.statusCode} ${r.body}`);
}

export function cripto() {
  const c = lerConfig();
  return new Cripto(c.CHAVE_CRIPTOGRAFIA, c.CHAVE_HMAC);
}

type Metodo = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT' | 'OPTIONS' | 'HEAD';

export class Navegador {
  cookies = new Map<string, string>();
  /** Segredo MFA do usuário, guardado no cadastro do autenticador */
  segredoMfa?: string;
  codigosRecuperacao: string[] = [];
  /** Último código MFA aceito para este navegador */
  ultimoCodigo?: string;
  enviarCsrf = true;

  constructor(private readonly app: App) {}

  async req(metodo: Metodo, caminho: string, corpo?: unknown, cabecalhos: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...cabecalhos };
    if (this.cookies.size && !headers.cookie) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const csrf = this.cookies.get(COOKIES.csrf);
    if (this.enviarCsrf && csrf && !['GET', 'HEAD'].includes(metodo)) headers['x-csrf-token'] = csrf;
    const res = await this.app.inject({
      method: metodo,
      url: caminho.startsWith('/') ? caminho : `${PREFIXO}/${caminho}`,
      payload: corpo as object | undefined,
      headers,
    });
    for (const c of res.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      const apagado = c.value === '' || c.maxAge === 0 || (c.expires && c.expires.getTime() < Date.now());
      if (apagado) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  /** Login completo: senha e MFA (cadastra o autenticador se for o primeiro acesso). */
  async entrar(email: string, senha = SENHA) {
    const login = await this.req('POST', 'auth/login', { email, senha });
    if (login.statusCode !== 200) throw new Error(`login ${login.statusCode} ${login.body}`);
    if (login.json().proximaEtapa === 'MFA_CONFIGURAR') {
      const cfg = await this.req('POST', 'auth/mfa/configurar');
      this.segredoMfa = cfg.json().chave;
      this.ultimoCodigo = await codigoMfaAtual(this.segredoMfa!);
      const ativar = await this.req('POST', 'auth/mfa/ativar', { codigo: this.ultimoCodigo });
      if (ativar.statusCode !== 200) throw new Error(`ativar ${ativar.statusCode} ${ativar.body}`);
      this.codigosRecuperacao = ativar.json().codigosRecuperacao;
      return ativar;
    }
    // Código da próxima janela de 30 s, para não repetir o código já usado neste teste
    this.ultimoCodigo = await codigoMfaAtual(this.segredoMfa!, Date.now() + 30_000);
    const v = await this.req('POST', 'auth/mfa/verificar', { codigo: this.ultimoCodigo });
    if (v.statusCode !== 200) throw new Error(`verificar ${v.statusCode} ${v.body}`);
    return v;
  }
}

let contador = 0;

/** Cria um usuário direto no banco (senha já definitiva) e devolve um navegador logado. */
export async function usuarioLogado(app: App, prisma: PrismaClient, perfil: PerfilUsuario, nome = `Pessoa ${perfil}`) {
  const email = `${perfil.toLowerCase()}${++contador}@ameta.com.br`;
  const u = await criarUsuario(prisma, cripto(), { nome, email, perfil, senha: SENHA }, {}, { deveTrocarSenha: false });
  const nav = new Navegador(app);
  await nav.entrar(email);
  return { nav, usuario: u, email };
}
