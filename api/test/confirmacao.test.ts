/** Ações sensíveis do ADMIN e troca de senha pedem a senha e o código do app de novo. */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEMPOS } from '../src/config.js';
import { App } from '../src/http/app.js';
import { codigoMfaAtual } from '../src/seguranca/totp.js';
import { Navegador, novaApp, SENHA, usuarioLogado } from './api-util.js';
import { limparBanco } from './util.js';

const prisma = new PrismaClient();
let app: App;
beforeEach(async () => {
  await limparBanco(prisma);
  app = await novaApp(prisma);
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

const NOVO = { nome: 'Pessoa Nova', email: 'nova@ameta.com.br', perfil: 'OPERADOR', senhaProvisoria: 'provisoria da ameta 01' };

/** ADMIN logado, mas sem ter confirmado a identidade nesta sessão */
async function adminSemConfirmar() {
  const l = await usuarioLogado(app, prisma, 'ADMIN');
  await prisma.sessao.updateMany({ where: { usuarioId: l.usuario.id }, data: { identidadeConfirmadaEm: null } });
  return l;
}

/** Código da próxima janela de 30 s (o da janela atual já foi usado no login) */
const proximoCodigo = (nav: Navegador) => codigoMfaAtual(nav.segredoMfa!, Date.now() + 30_000);

/** Permite usar um código de novo (no teste, em vez de esperar 30 s pela próxima janela) */
const liberarCodigo = (usuarioId: string) => prisma.usuario.update({ where: { id: usuarioId }, data: { mfaUltimoPasso: null } });

describe('confirmar senha e código do app', () => {
  it('ADMIN precisa confirmar antes de mexer em usuários; ver continua livre', async () => {
    const { nav } = await adminSemConfirmar();
    expect((await nav.req('GET', 'usuarios')).statusCode).toBe(200);
    const sem = await nav.req('POST', 'usuarios', NOVO);
    expect(sem.statusCode).toBe(403);
    expect(sem.json().codigo).toBe('CONFIRMAR_IDENTIDADE');
    expect(await prisma.usuario.count()).toBe(1);

    const ok = await nav.req('POST', 'auth/confirmar-identidade', { senha: SENHA, codigo: await proximoCodigo(nav) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().validoPorSegundos).toBe(300);
    expect((await nav.req('POST', 'usuarios', NOVO)).statusCode).toBe(201);
    expect(await prisma.logAuditoria.count({ where: { acao: 'IDENTIDADE_CONFIRMADA' } })).toBe(1);
  });

  it('senha errada, código errado ou código repetido não confirmam e contam como tentativa errada', async () => {
    const { nav, usuario } = await adminSemConfirmar();
    const codigo = await proximoCodigo(nav);
    expect((await nav.req('POST', 'auth/confirmar-identidade', { senha: 'senha errada de teste', codigo })).statusCode).toBe(422);
    expect((await nav.req('POST', 'auth/confirmar-identidade', { senha: SENHA, codigo: '000000' })).statusCode).toBe(422);
    expect((await nav.req('POST', 'auth/confirmar-identidade', { senha: SENHA, codigo })).statusCode).toBe(200);
    // O mesmo código não serve duas vezes
    await prisma.sessao.updateMany({ where: { usuarioId: usuario.id }, data: { identidadeConfirmadaEm: null } });
    expect((await nav.req('POST', 'auth/confirmar-identidade', { senha: SENHA, codigo })).statusCode).toBe(422);
    expect(await prisma.logAuditoria.count({ where: { acao: 'LOGIN_FALHOU', valoresDepois: { path: ['etapa'], equals: 'confirmacao' } } })).toBe(3);
    expect((await nav.req('POST', 'usuarios', NOVO)).statusCode).toBe(403);
  });

  it('5 erros bloqueiam a conta: nem a senha certa confirma', async () => {
    const { nav, usuario } = await adminSemConfirmar();
    for (let i = 0; i < 5; i++) await nav.req('POST', 'auth/confirmar-identidade', { senha: SENHA, codigo: '000000' });
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } })).bloqueadoAte).not.toBeNull();
    const r = await nav.req('POST', 'auth/confirmar-identidade', { senha: SENHA, codigo: await proximoCodigo(nav) });
    expect(r.statusCode).toBe(429);
  });

  it('a confirmação vale 5 minutos e só na sessão onde foi feita', async () => {
    const { nav, usuario, email } = await adminSemConfirmar();
    await nav.req('POST', 'auth/confirmar-identidade', { senha: SENHA, codigo: await proximoCodigo(nav) });
    expect((await nav.req('POST', 'usuarios', NOVO)).statusCode).toBe(201);

    // Outro navegador da mesma pessoa não herda a confirmação
    await liberarCodigo(usuario.id);
    const outro = new Navegador(app);
    outro.segredoMfa = nav.segredoMfa;
    await outro.entrar(email);
    expect((await outro.req('POST', 'usuarios', { ...NOVO, email: 'outra@ameta.com.br' })).statusCode).toBe(403);

    // Passados os 5 minutos, pede de novo
    const antigo = new Date(Date.now() - TEMPOS.confirmacaoMs - 1000);
    await prisma.sessao.updateMany({ where: { usuarioId: usuario.id }, data: { identidadeConfirmadaEm: antigo } });
    const r = await nav.req('POST', 'usuarios', { ...NOVO, email: 'outra@ameta.com.br' });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('CONFIRMAR_IDENTIDADE');
  });

  it('restaurar e excluir de vez também pedem confirmação; o dia a dia do operador não', async () => {
    const { nav: admin } = await adminSemConfirmar();
    const { nav: operador } = await usuarioLogado(app, prisma, 'OPERADOR');
    const criado = await operador.req('POST', 'itens', { numeroPo: '777001' });
    expect(criado.statusCode).toBe(201);
    const id = criado.json().id;
    expect((await operador.req('DELETE', `itens/${id}`)).statusCode).toBe(200);
    for (const [metodo, caminho] of [['POST', `itens/${id}/restaurar`], ['DELETE', `itens/${id}/definitivo`]] as const) {
      const r = await admin.req(metodo, caminho);
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('CONFIRMAR_IDENTIDADE');
    }
  });

  it('trocar a senha pede a senha atual e o código do app (menos na senha provisória)', async () => {
    const { nav } = await usuarioLogado(app, prisma, 'OPERADOR');
    const nova = 'outra frase longa da ameta';
    const semCodigo = await nav.req('POST', 'auth/trocar-senha', { senhaAtual: SENHA, novaSenha: nova });
    expect(semCodigo.statusCode).toBe(422);
    expect(semCodigo.json().erro).toContain('código');
    expect((await nav.req('POST', 'auth/trocar-senha', { senhaAtual: SENHA, novaSenha: nova, codigo: '000000' })).statusCode).toBe(422);
    const ok = await nav.req('POST', 'auth/trocar-senha', { senhaAtual: SENHA, novaSenha: nova, codigo: await proximoCodigo(nav) });
    expect(ok.statusCode).toBe(200);
  });

  it('o inventário marca as rotas que pedem confirmação', () => {
    const marcadas = app.inventarioRotas.filter((r) => r.confirmar).map((r) => `${r.metodo} ${r.url}`).sort();
    expect(marcadas).toEqual([
      'DELETE /api/v1/itens/:id/definitivo',
      'DELETE /api/v1/usuarios/:id',
      'PATCH /api/v1/usuarios/:id',
      'POST /api/v1/itens/:id/restaurar',
      'POST /api/v1/usuarios',
      'POST /api/v1/usuarios/:id/desbloquear',
      'POST /api/v1/usuarios/:id/reenviar-convite',
      'POST /api/v1/usuarios/:id/resetar-mfa',
      'POST /api/v1/usuarios/:id/senha-provisoria',
    ]);
  });
});
