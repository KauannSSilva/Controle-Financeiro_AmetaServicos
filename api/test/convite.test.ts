/** Convite por e-mail: quem o ADMIN cria só entra depois de aceitar o link recebido. */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/http/app.js';
import { aceitarConvite, caixaDeEntrada, Navegador, novaApp, smtp, tokenConvite, ultimoEmail, usuarioLogado } from './api-util.js';
import { limparBanco } from './util.js';

const prisma = new PrismaClient();
let app: App;
let admin: Navegador;
beforeEach(async () => {
  await limparBanco(prisma);
  caixaDeEntrada.length = 0;
  smtp.fora = false;
  app = await novaApp(prisma);
  admin = (await usuarioLogado(app, prisma, 'ADMIN')).nav;
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

const PROVISORIA = 'provisoria da ameta 01';
const EMAIL = 'dani@ameta.com.br';
const criar = (email = EMAIL) =>
  admin.req('POST', 'usuarios', { nome: 'Daniela <Costa>', email, perfil: 'OPERADOR', senhaProvisoria: PROVISORIA });

describe('convite por e-mail', () => {
  it('o e-mail traz o nome, o e-mail, a senha provisória e o link', async () => {
    const r = await criar();
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ conviteEnviado: true, conviteAceito: false });
    expect(new Date(r.json().conviteExpiraEm).getTime()).toBeGreaterThan(Date.now() + 71 * 3600_000);
    const m = ultimoEmail(EMAIL);
    for (const parte of [m.texto, m.html]) {
      expect(parte).toContain(PROVISORIA);
      expect(parte).toContain(EMAIL);
      expect(parte).toContain('http://localhost:5173/convite#');
    }
    expect(m.texto).toContain('Daniela <Costa>');
    // HTML escapado: o nome não vira tag
    expect(m.html).toContain('Daniela &lt;Costa&gt;');
    expect(m.html).not.toContain('<Costa>');
    // O token do link não fica guardado em texto no banco
    const token = tokenConvite(EMAIL);
    const u = await prisma.usuario.findFirstOrThrow({ where: { conviteTokenHash: { not: null } } });
    expect(u.conviteTokenHash).not.toBe(token);
    expect(u.conviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('não entra antes de aceitar; depois entra com a senha provisória', async () => {
    await criar();
    const nav = new Navegador(app);
    const antes = await nav.req('POST', 'auth/login', { email: EMAIL, senha: PROVISORIA });
    expect(antes.statusCode).toBe(403);
    expect(antes.json().erro).toContain('Aceite o convite');
    expect(nav.cookies.has('ameta_pre_mfa')).toBe(false);
    // Senha errada continua dando a resposta genérica (não revela que existe convite)
    expect((await nav.req('POST', 'auth/login', { email: EMAIL, senha: 'senha errada qualquer' })).statusCode).toBe(401);

    const aceito = await new Navegador(app).req('POST', 'auth/convite/aceitar', { token: tokenConvite(EMAIL) });
    expect(aceito.statusCode).toBe(200);
    expect(aceito.json()).toEqual({ email: EMAIL });
    await nav.entrar(EMAIL, PROVISORIA);
    expect((await nav.req('GET', 'itens')).json().codigo).toBe('TROCAR_SENHA');
  });

  it('o link vale uma vez só e expira', async () => {
    await criar();
    const token = tokenConvite(EMAIL);
    await aceitarConvite(app, EMAIL);
    const denovo = await new Navegador(app).req('POST', 'auth/convite/aceitar', { token });
    expect(denovo.statusCode).toBe(422);
    expect(denovo.json().erro).toContain('expirado ou já usado');

    await criar('eva@ameta.com.br');
    await prisma.usuario.updateMany({ where: { conviteExpiraEm: { not: null } }, data: { conviteExpiraEm: new Date(Date.now() - 1000) } });
    expect((await new Navegador(app).req('POST', 'auth/convite/aceitar', { token: tokenConvite('eva@ameta.com.br') })).statusCode).toBe(422);
    expect((await new Navegador(app).req('POST', 'auth/convite/aceitar', { token: 'x'.repeat(43) })).statusCode).toBe(422);
  });

  it('reenviar troca a senha provisória e invalida o link anterior', async () => {
    const id = (await criar()).json().id;
    const antigo = tokenConvite(EMAIL);
    const r = await admin.req('POST', `usuarios/${id}/reenviar-convite`, { senhaProvisoria: 'outra provisoria da ameta' });
    expect(r.json()).toEqual({ ok: true, conviteEnviado: true });
    expect(ultimoEmail(EMAIL).texto).toContain('outra provisoria da ameta');
    expect((await new Navegador(app).req('POST', 'auth/convite/aceitar', { token: antigo })).statusCode).toBe(422);
    await aceitarConvite(app, EMAIL);
    const nav = new Navegador(app);
    expect((await nav.req('POST', 'auth/login', { email: EMAIL, senha: PROVISORIA })).statusCode).toBe(401);
    expect((await nav.req('POST', 'auth/login', { email: EMAIL, senha: 'outra provisoria da ameta' })).statusCode).toBe(200);
    // Depois de aceito, não há o que reenviar
    expect((await admin.req('POST', `usuarios/${id}/reenviar-convite`, { senhaProvisoria: 'mais uma provisoria ameta' })).statusCode).toBe(422);
  });

  it('se o e-mail não sair, o usuário fica criado e o ADMIN pode reenviar', async () => {
    smtp.fora = true;
    const r = await criar();
    expect(r.statusCode).toBe(201);
    expect(r.json().conviteEnviado).toBe(false);
    const acoes = (await prisma.logAuditoria.findMany()).map((l) => l.acao);
    expect(acoes).toContain('CONVITE_NAO_ENVIADO');
    smtp.fora = false;
    expect((await admin.req('POST', `usuarios/${r.json().id}/reenviar-convite`, { senhaProvisoria: PROVISORIA })).json().conviteEnviado).toBe(true);
    await aceitarConvite(app, EMAIL);
  });

  it('usuário excluído não consegue aceitar o convite', async () => {
    const id = (await criar()).json().id;
    await admin.req('DELETE', `usuarios/${id}`);
    expect((await new Navegador(app).req('POST', 'auth/convite/aceitar', { token: tokenConvite(EMAIL) })).statusCode).toBe(422);
  });
});
