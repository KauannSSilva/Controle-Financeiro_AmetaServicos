import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/http/app.js';
import { COOKIES } from '../src/http/comum.js';
import { codigoMfaAtual } from '../src/seguranca/totp.js';
import { criarUsuario } from '../src/usuarios/usuarios.js';
import { cripto, Navegador, novaApp, SENHA, usuarioLogado } from './api-util.js';
import { limparBanco } from './util.js';

const prisma = new PrismaClient();
let app: App;
beforeEach(async () => {
  await limparBanco(prisma);
  app = await novaApp(prisma);
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

const criar = (email = 'ana@ameta.com.br', perfil: 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR' = 'OPERADOR') =>
  criarUsuario(prisma, cripto(), { nome: 'Ana', email, perfil, senha: SENHA }, {}, { deveTrocarSenha: false });

describe('login com senha', () => {
  it('senha errada e e-mail inexistente dão a mesma resposta genérica', async () => {
    await criar();
    const nav = new Navegador(app);
    const errada = await nav.req('POST', 'auth/login', { email: 'ana@ameta.com.br', senha: 'senha errada qualquer' });
    const inexistente = await nav.req('POST', 'auth/login', { email: 'ninguem@ameta.com.br', senha: 'senha errada qualquer' });
    expect(errada.statusCode).toBe(401);
    expect(inexistente.statusCode).toBe(401);
    expect(errada.json()).toEqual(inexistente.json());
    expect(errada.json().erro).toBe('E-mail ou senha inválidos');
    expect(await prisma.logAuditoria.count({ where: { acao: 'LOGIN_FALHOU' } })).toBe(2);
  });

  it('e-mail com maiúsculas e espaços funciona', async () => {
    await criar();
    const res = await new Navegador(app).req('POST', 'auth/login', { email: '  Ana@Ameta.com.BR ', senha: SENHA });
    expect(res.json()).toEqual({ proximaEtapa: 'MFA_CONFIGURAR' });
  });

  it('5 erros seguidos bloqueiam o usuário, mesmo com a senha certa depois', async () => {
    await criar();
    const nav = new Navegador(app);
    for (let i = 0; i < 5; i++) {
      expect((await nav.req('POST', 'auth/login', { email: 'ana@ameta.com.br', senha: `errada-${i}-xxxxxxx` })).statusCode).toBe(401);
    }
    const certa = await nav.req('POST', 'auth/login', { email: 'ana@ameta.com.br', senha: SENHA });
    expect(certa.statusCode).toBe(429);
    const u = await prisma.usuario.findFirstOrThrow();
    expect(u.bloqueadoAte!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(await prisma.logAuditoria.count({ where: { acao: 'USUARIO_BLOQUEADO_TENTATIVAS' } })).toBe(1);
  });

  it('e-mail inexistente também é bloqueado após 5 tentativas (não revela se existe)', async () => {
    const nav = new Navegador(app);
    for (let i = 0; i < 5; i++) await nav.req('POST', 'auth/login', { email: 'x@ameta.com.br', senha: 'qualquer coisa 123' });
    expect((await nav.req('POST', 'auth/login', { email: 'x@ameta.com.br', senha: 'qualquer coisa 123' })).statusCode).toBe(429);
  });

  it('usuário bloqueado pelo ADMIN ou excluído não entra', async () => {
    const u = await criar();
    await prisma.usuario.update({ where: { id: u.id }, data: { ativo: false } });
    expect((await new Navegador(app).req('POST', 'auth/login', { email: 'ana@ameta.com.br', senha: SENHA })).statusCode).toBe(401);
  });

  it('dados pessoais ficam cifrados no banco', async () => {
    await criar();
    const [linha] = await prisma.$queryRaw<{ t: string }[]>`SELECT row_to_json(u)::text AS t FROM usuarios u`;
    expect(linha.t).not.toContain('ana@ameta.com.br');
    expect(linha.t).not.toContain('Ana');
    expect(linha.t).not.toContain(SENHA);
    expect(linha.t).toContain('$argon2id$');
  });
});

describe('MFA', () => {
  it('primeiro acesso: QR Code, confirmação, 10 códigos de recuperação e sessão aberta', async () => {
    await criar();
    const nav = new Navegador(app);
    await nav.req('POST', 'auth/login', { email: 'ana@ameta.com.br', senha: SENHA });
    const cfg = await nav.req('POST', 'auth/mfa/configurar');
    expect(cfg.json().chave).toMatch(/^[A-Z2-7]{32}$/);
    expect(cfg.json().uri).toContain('otpauth://totp/Ameta%20Servi%C3%A7os:ana%40ameta.com.br');
    expect(cfg.json().qrCode).toMatch(/^data:image\/png;base64,/);
    const png = await nav.req('GET', 'auth/mfa/qrcode.png');
    expect(png.headers['content-type']).toBe('image/png');

    // Segredo gravado cifrado e MFA ainda inativo
    const antes = await prisma.usuario.findFirstOrThrow();
    expect(antes.mfaAtivo).toBe(false);
    expect(Buffer.from(antes.mfaSecretCifrado!).toString()).not.toContain(cfg.json().chave);

    expect((await nav.req('POST', 'auth/mfa/ativar', { codigo: '000000' })).statusCode).toBe(401);
    const ok = await nav.req('POST', 'auth/mfa/ativar', { codigo: await codigoMfaAtual(cfg.json().chave) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().codigosRecuperacao).toHaveLength(10);
    expect(new Set(ok.json().codigosRecuperacao).size).toBe(10);
    expect(await prisma.codigoRecuperacaoMfa.count()).toBe(10);
    expect(JSON.stringify(await prisma.codigoRecuperacaoMfa.findMany())).not.toContain(ok.json().codigosRecuperacao[0]);
    expect((await nav.req('GET', 'auth/eu')).json()).toMatchObject({ email: 'ana@ameta.com.br', perfil: 'OPERADOR', mfaAtivo: true });
    expect(nav.cookies.has(COOKIES.preMfa)).toBe(false);
  });

  it('o mesmo código não vale duas vezes; o da janela seguinte (±30 s) vale', async () => {
    const { email, nav: primeiro } = await usuarioLogado(app, prisma, 'OPERADOR');
    const segredo = primeiro.segredoMfa!;
    const nav = new Navegador(app);
    await nav.req('POST', 'auth/login', { email, senha: SENHA });
    // O código usado na ativação não vale de novo
    expect((await nav.req('POST', 'auth/mfa/verificar', { codigo: primeiro.ultimoCodigo })).statusCode).toBe(401);
    expect((await nav.req('POST', 'auth/mfa/verificar', { codigo: await codigoMfaAtual(segredo, Date.now() + 30_000) })).statusCode).toBe(200);
  });

  it('código de 2 minutos atrás é recusado', async () => {
    const { email, nav: primeiro } = await usuarioLogado(app, prisma, 'OPERADOR');
    await prisma.usuario.updateMany({ data: { mfaUltimoPasso: null } });
    const nav = new Navegador(app);
    await nav.req('POST', 'auth/login', { email, senha: SENHA });
    const velho = await codigoMfaAtual(primeiro.segredoMfa!, Date.now() - 120_000);
    expect((await nav.req('POST', 'auth/mfa/verificar', { codigo: velho })).statusCode).toBe(401);
  });

  it('código de recuperação vale uma vez só', async () => {
    const { email, nav: primeiro } = await usuarioLogado(app, prisma, 'OPERADOR');
    const codigo = primeiro.codigosRecuperacao[0];
    const a = new Navegador(app);
    await a.req('POST', 'auth/login', { email, senha: SENHA });
    const ok = await a.req('POST', 'auth/mfa/verificar', { codigoRecuperacao: codigo.toLowerCase() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().codigosRecuperacaoRestantes).toBe(9);
    const b = new Navegador(app);
    await b.req('POST', 'auth/login', { email, senha: SENHA });
    expect((await b.req('POST', 'auth/mfa/verificar', { codigoRecuperacao: codigo })).statusCode).toBe(401);
  });

  it('5 códigos errados também bloqueiam', async () => {
    const { email } = await usuarioLogado(app, prisma, 'OPERADOR');
    const nav = new Navegador(app);
    await nav.req('POST', 'auth/login', { email, senha: SENHA });
    for (let i = 0; i < 5; i++) await nav.req('POST', 'auth/mfa/verificar', { codigo: '000000' });
    expect((await nav.req('POST', 'auth/mfa/verificar', { codigo: '000000' })).statusCode).toBe(429);
  });

  it('não dá para pular o MFA: só com a senha nenhuma rota de dados abre', async () => {
    await criar();
    const nav = new Navegador(app);
    await nav.req('POST', 'auth/login', { email: 'ana@ameta.com.br', senha: SENHA });
    expect((await nav.req('GET', 'itens')).statusCode).toBe(401);
    expect((await nav.req('GET', 'auth/eu')).statusCode).toBe(401);
    // O token da etapa de senha não serve como token de acesso
    const res = await nav.req('GET', 'itens', undefined, { cookie: `${COOKIES.acesso}=${nav.cookies.get(COOKIES.preMfa)}` });
    expect(res.statusCode).toBe(401);
  });

  it('token com alg "none" ou assinado com outra chave é recusado', async () => {
    const { nav, usuario } = await usuarioLogado(app, prisma, 'ADMIN');
    const sessao = await prisma.sessao.findFirstOrThrow({ where: { usuarioId: usuario.id } });
    const corpo = Buffer.from(JSON.stringify({ sub: usuario.id, sid: sessao.id, iss: 'ameta-api', aud: 'api', exp: 9999999999 })).toString('base64url');
    const semAssinatura = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${corpo}.`;
    const outraChave = await new SignJWT({ sid: sessao.id }).setProtectedHeader({ alg: 'HS256' }).setSubject(usuario.id)
      .setIssuer('ameta-api').setAudience('api').setExpirationTime('5m').sign(new TextEncoder().encode('x'.repeat(32)));
    for (const token of [semAssinatura, outraChave]) {
      expect((await nav.req('GET', 'itens', undefined, { cookie: `${COOKIES.acesso}=${token}` })).statusCode).toBe(401);
    }
  });

  it('ADMIN reseta o MFA: sessões caem e o próximo login cadastra de novo', async () => {
    const { nav: admin } = await usuarioLogado(app, prisma, 'ADMIN');
    const { nav: op, usuario, email } = await usuarioLogado(app, prisma, 'OPERADOR');
    expect((await admin.req('POST', `usuarios/${usuario.id}/resetar-mfa`)).statusCode).toBe(200);
    expect((await op.req('GET', 'itens')).statusCode).toBe(401);
    const login = await new Navegador(app).req('POST', 'auth/login', { email, senha: SENHA });
    expect(login.json().proximaEtapa).toBe('MFA_CONFIGURAR');
    expect(await prisma.codigoRecuperacaoMfa.count({ where: { usuarioId: usuario.id } })).toBe(0);
    expect(await prisma.logAuditoria.count({ where: { acao: 'MFA_RESETADO', entidadeId: usuario.id } })).toBe(1);
  });
});

describe('sessão', () => {
  it('renovar troca o refresh token; o antigo deixa de valer', async () => {
    const { nav } = await usuarioLogado(app, prisma, 'OPERADOR');
    const antigo = nav.cookies.get(COOKIES.refresh)!;
    expect((await nav.req('POST', 'auth/renovar')).statusCode).toBe(200);
    expect(nav.cookies.get(COOKIES.refresh)).not.toBe(antigo);
    const reuso = await nav.req('POST', 'auth/renovar', undefined, {
      cookie: `${COOKIES.refresh}=${antigo}; ${COOKIES.csrf}=${nav.cookies.get(COOKIES.csrf)}`,
    });
    expect(reuso.statusCode).toBe(401);
  });

  it('sair revoga a sessão no servidor (o token antigo não funciona mais)', async () => {
    const { nav } = await usuarioLogado(app, prisma, 'OPERADOR');
    const acesso = nav.cookies.get(COOKIES.acesso)!;
    expect((await nav.req('POST', 'auth/sair')).statusCode).toBe(200);
    expect(nav.cookies.has(COOKIES.acesso)).toBe(false);
    expect((await nav.req('GET', 'itens', undefined, { cookie: `${COOKIES.acesso}=${acesso}` })).statusCode).toBe(401);
  });

  it('sessão expira após 30 minutos sem uso', async () => {
    const { nav } = await usuarioLogado(app, prisma, 'OPERADOR');
    await prisma.sessao.updateMany({ data: { ultimoUsoEm: new Date(Date.now() - 31 * 60_000) } });
    expect((await nav.req('GET', 'itens')).statusCode).toBe(401);
    expect((await nav.req('POST', 'auth/renovar')).statusCode).toBe(401);
  });

  it('cookies HttpOnly, SameSite=Strict e Secure; CSRF obrigatório em alterações', async () => {
    await criar();
    const nav = new Navegador(app);
    await nav.req('POST', 'auth/login', { email: 'ana@ameta.com.br', senha: SENHA });
    const cfg = await nav.req('POST', 'auth/mfa/configurar');
    const ativar = await nav.req('POST', 'auth/mfa/ativar', { codigo: await codigoMfaAtual(cfg.json().chave) });
    const cookies = ativar.cookies as { name: string; httpOnly?: boolean; sameSite?: string; secure?: boolean }[];
    const acesso = cookies.find((c) => c.name === COOKIES.acesso)!;
    expect(acesso).toMatchObject({ httpOnly: true, sameSite: 'Strict', secure: true });
    expect(cookies.find((c) => c.name === COOKIES.csrf)).toMatchObject({ sameSite: 'Strict', secure: true });

    nav.enviarCsrf = false;
    const semCsrf = await nav.req('POST', 'itens', { numeroPo: '4533000001' });
    expect(semCsrf.statusCode).toBe(403);
    const csrfErrado = await nav.req('POST', 'itens', { numeroPo: '4533000001' }, { 'x-csrf-token': 'falso' });
    expect(csrfErrado.statusCode).toBe(403);
    nav.enviarCsrf = true;
    expect((await nav.req('POST', 'itens', { numeroPo: '4533000001' })).statusCode).toBe(201);
  });
});

describe('senha', () => {
  it('usuário criado pelo ADMIN troca a senha provisória antes de usar o sistema', async () => {
    const { nav: admin } = await usuarioLogado(app, prisma, 'ADMIN');
    const criado = await admin.req('POST', 'usuarios', {
      nome: 'Bruno Lima', email: 'bruno@ameta.com.br', perfil: 'OPERADOR', senhaProvisoria: 'provisoria da ameta 01',
    });
    expect(criado.statusCode).toBe(201);
    expect(criado.json()).toMatchObject({ nome: 'Bruno Lima', deveTrocarSenha: true, mfaAtivo: false });
    expect(criado.json()).not.toHaveProperty('senhaHash');

    const bruno = new Navegador(app);
    await bruno.entrar('bruno@ameta.com.br', 'provisoria da ameta 01');
    const bloqueado = await bruno.req('GET', 'itens');
    expect(bloqueado.statusCode).toBe(403);
    expect(bloqueado.json().codigo).toBe('TROCAR_SENHA');
    expect((await bruno.req('POST', 'auth/trocar-senha', { senhaAtual: 'provisoria da ameta 01', novaSenha: 'curta' })).statusCode).toBe(422);
    expect((await bruno.req('POST', 'auth/trocar-senha', { senhaAtual: 'provisoria da ameta 01', novaSenha: 'senha123456789' })).statusCode).toBe(422);
    expect((await bruno.req('POST', 'auth/trocar-senha', { senhaAtual: 'provisoria da ameta 01', novaSenha: 'minha senha nova e longa' })).statusCode).toBe(200);
    expect((await bruno.req('GET', 'itens')).statusCode).toBe(200);
  });

  it('política: mínimo 12 caracteres e sem senhas comuns', async () => {
    for (const ruim of ['curta', '123456789012', 'password12345', 'aaaaaaaaaaaaaa', 'Ameta2026!!!!', 'ana@ameta.com.br2026']) {
      await expect(criarUsuario(prisma, cripto(), { nome: 'Ana', email: 'ana@ameta.com.br', perfil: 'OPERADOR', senha: ruim }))
        .rejects.toThrow();
    }
  });
});
