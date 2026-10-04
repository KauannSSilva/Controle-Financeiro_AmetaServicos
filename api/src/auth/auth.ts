/**
 * Login em duas etapas (senha, depois código MFA), sessões com refresh token rotativo
 * e bloqueio progressivo por tentativas erradas. Não existe caminho que pule o MFA:
 * a sessão só é criada depois de um código TOTP (ou de recuperação) válido.
 */
import { Prisma, PrismaClient, Usuario } from '@prisma/client';
import { jwtVerify, SignJWT } from 'jose';
import { Config, TEMPOS } from '../config.js';
import {
  ErroHttp, ErroRegra, MSG_BLOQUEADO, MSG_LOGIN_INVALIDO, MSG_MFA_INVALIDO, MSG_SESSAO,
} from '../erros.js';
import { Cripto, sha256, tokenAleatorio } from '../seguranca/cripto.js';
import { conferirSenha, hashParaTempoConstante, hashSenha, validarPoliticaSenha } from '../seguranca/senha.js';
import {
  conferirCodigoMfa, normalizarCodigoRecuperacao, novoCodigoRecuperacao, novoSegredoMfa, qrCodePng, uriMfa,
} from '../seguranca/totp.js';
import { revogarSessoes } from '../usuarios/usuarios.js';

const ALG = 'HS256';
const EMISSOR = 'ameta-api';

export interface Origem {
  ip?: string | null;
  userAgent?: string | null;
}

export interface SessaoCriada {
  acesso: string;
  refresh: string;
  csrf: string;
  sessaoId: string;
}

export interface UsuarioLogado {
  usuario: Usuario;
  sessaoId: string;
}

export type ProximaEtapa = 'MFA_CONFIGURAR' | 'MFA_VERIFICAR';

/** Falhas guardadas em memória: por IP e por e-mail que não existe (para responder igual a um e-mail real). */
class ContadorFalhas {
  private readonly falhas = new Map<string, number[]>();

  constructor(private readonly limite: number) {}

  registrar(chave: string, agora = Date.now()) {
    const lista = this.recentes(chave, agora);
    lista.push(agora);
    this.falhas.set(chave, lista);
  }

  bloqueado(chave: string, agora = Date.now()) {
    return this.recentes(chave, agora).length >= this.limite;
  }

  limpar(chave: string) {
    this.falhas.delete(chave);
  }

  private recentes(chave: string, agora: number) {
    const lista = (this.falhas.get(chave) ?? []).filter((t) => agora - t < TEMPOS.janelaFalhasMs);
    if (this.falhas.size > 50_000) this.falhas.clear(); // evita crescer sem limite num ataque
    return lista;
  }
}

export class Autenticacao {
  private readonly chaveJwt: Uint8Array;
  /** Um IP com 10 falhas em 15 min fica bloqueado (protege contra quem testa vários e-mails). */
  private readonly falhasIp = new ContadorFalhas(TEMPOS.maxFalhas * 2);
  private readonly falhasEmailInexistente = new ContadorFalhas(TEMPOS.maxFalhas);

  constructor(private readonly prisma: PrismaClient, private readonly cripto: Cripto, config: Pick<Config, 'JWT_SEGREDO'>) {
    this.chaveJwt = Buffer.from(config.JWT_SEGREDO, 'base64');
  }

  // ---------- Etapa 1: e-mail e senha ----------

  async login(email: string, senha: string, origem: Origem): Promise<{ usuarioId: string; proximaEtapa: ProximaEtapa; tokenPreMfa: string }> {
    const ip = origem.ip ?? 'desconhecido';
    if (this.falhasIp.bloqueado(ip)) throw new ErroHttp(429, MSG_BLOQUEADO);
    const emailHash = this.cripto.hashEmail(email);
    const u = await this.prisma.usuario.findUnique({ where: { emailHash } });

    if (!u || u.excluidoEm) {
      await conferirSenha(await hashParaTempoConstante(), senha); // mesmo tempo de resposta de um e-mail real
      if (this.falhasEmailInexistente.bloqueado(emailHash)) throw new ErroHttp(429, MSG_BLOQUEADO);
      this.falhasEmailInexistente.registrar(emailHash);
      this.falhasIp.registrar(ip);
      await this.auditar(null, 'LOGIN_FALHOU', origem, { etapa: 'senha' });
      throw new ErroHttp(401, MSG_LOGIN_INVALIDO);
    }
    if (u.bloqueadoAte && u.bloqueadoAte > new Date()) throw new ErroHttp(429, MSG_BLOQUEADO);

    const senhaOk = await conferirSenha(u.senhaHash, senha);
    if (!senhaOk || !u.ativo) {
      this.falhasIp.registrar(ip);
      if (!senhaOk) await this.registrarFalha(u, origem, 'senha');
      else await this.auditar(u.id, 'LOGIN_FALHOU', origem, { etapa: 'senha', motivo: 'usuario_inativo' });
      throw new ErroHttp(401, MSG_LOGIN_INVALIDO);
    }

    await this.auditar(u.id, 'LOGIN_SENHA_OK', origem);
    const tokenPreMfa = await new SignJWT({ etp: 'mfa' })
      .setProtectedHeader({ alg: ALG, typ: 'JWT' })
      .setSubject(u.id).setIssuer(EMISSOR).setAudience('pre-mfa').setIssuedAt()
      .setExpirationTime(`${TEMPOS.preMfaSeg}s`)
      .sign(this.chaveJwt);
    return { usuarioId: u.id, proximaEtapa: u.mfaAtivo ? 'MFA_VERIFICAR' : 'MFA_CONFIGURAR', tokenPreMfa };
  }

  /** Lê o token entre a senha e o MFA. */
  async validarPreMfa(token: string | undefined): Promise<Usuario> {
    if (!token) throw new ErroHttp(401, 'Entre com e-mail e senha primeiro');
    try {
      const { payload } = await jwtVerify(token, this.chaveJwt, { algorithms: [ALG], issuer: EMISSOR, audience: 'pre-mfa' });
      const u = await this.prisma.usuario.findUnique({ where: { id: String(payload.sub) } });
      if (!u || !u.ativo || u.excluidoEm || payload.etp !== 'mfa') throw new Error();
      if (u.bloqueadoAte && u.bloqueadoAte > new Date()) throw new ErroHttp(429, MSG_BLOQUEADO);
      return u;
    } catch (e) {
      if (e instanceof ErroHttp) throw e;
      throw new ErroHttp(401, 'Tempo esgotado. Entre com e-mail e senha de novo.');
    }
  }

  // ---------- Etapa 2a: primeiro acesso, cadastrar o autenticador ----------

  /** Gera (ou devolve o já gerado) segredo do autenticador. Só antes do MFA estar ativo. */
  async configurarMfa(u: Usuario) {
    if (u.mfaAtivo) throw new ErroRegra('O MFA já está ativo. Peça ao ADMIN para resetar se trocou de celular.');
    let segredo: string;
    if (u.mfaSecretCifrado) {
      segredo = this.cripto.decifrar(u.mfaSecretCifrado);
    } else {
      segredo = novoSegredoMfa();
      await this.prisma.usuario.update({ where: { id: u.id }, data: { mfaSecretCifrado: this.cripto.cifrar(segredo) } });
    }
    const uri = uriMfa(segredo, this.cripto.decifrar(u.emailCifrado));
    return { chave: segredo, uri };
  }

  /** QR Code do segredo já gerado em configurarMfa (só leitura). */
  async qrCodeMfa(u: Usuario): Promise<Buffer> {
    if (u.mfaAtivo || !u.mfaSecretCifrado) throw new ErroRegra('Gere o QR Code em mfa/configurar primeiro');
    return qrCodePng(uriMfa(this.cripto.decifrar(u.mfaSecretCifrado), this.cripto.decifrar(u.emailCifrado)));
  }

  /** Confirma o primeiro código, ativa o MFA, gera os 10 códigos de recuperação e abre a sessão. */
  async ativarMfa(u: Usuario, codigo: string, origem: Origem) {
    if (u.mfaAtivo) throw new ErroRegra('O MFA já está ativo');
    if (!u.mfaSecretCifrado) throw new ErroRegra('Gere o QR Code antes de confirmar');
    const passo = await conferirCodigoMfa(this.cripto.decifrar(u.mfaSecretCifrado), codigo, u.mfaUltimoPasso);
    if (passo == null) {
      await this.registrarFalha(u, origem, 'mfa');
      throw new ErroHttp(401, MSG_MFA_INVALIDO);
    }
    const codigos = Array.from({ length: 10 }, novoCodigoRecuperacao);
    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: u.id },
        data: { mfaAtivo: true, mfaUltimoPasso: passo, tentativasFalhas: 0, bloqueadoAte: null },
      });
      await tx.codigoRecuperacaoMfa.deleteMany({ where: { usuarioId: u.id } });
      await tx.codigoRecuperacaoMfa.createMany({
        data: codigos.map((c) => ({ usuarioId: u.id, codigoHash: this.hashRecuperacao(c) })),
      });
      await this.auditar(u.id, 'MFA_ATIVADO', origem, undefined, tx);
    });
    const sessao = await this.criarSessao(u.id, origem);
    await this.auditar(u.id, 'LOGIN_SUCESSO', origem, { metodo: 'totp', primeiroAcesso: true });
    return { sessao, codigosRecuperacao: codigos };
  }

  // ---------- Etapa 2b: código do autenticador (ou de recuperação) ----------

  async verificarMfa(u: Usuario, entrada: { codigo?: string; codigoRecuperacao?: string }, origem: Origem) {
    if (!u.mfaAtivo || !u.mfaSecretCifrado) throw new ErroRegra('Cadastre o autenticador primeiro');
    let metodo: 'totp' | 'recuperacao';
    let restantes: number | undefined;

    if (entrada.codigo) {
      metodo = 'totp';
      const passo = await conferirCodigoMfa(this.cripto.decifrar(u.mfaSecretCifrado), entrada.codigo, u.mfaUltimoPasso);
      // updateMany com a condição do último passo impede que duas requisições aceitem o mesmo código ao mesmo tempo
      const gravou = passo != null && (await this.prisma.usuario.updateMany({
        where: { id: u.id, OR: [{ mfaUltimoPasso: null }, { mfaUltimoPasso: { lt: passo } }] },
        data: { mfaUltimoPasso: passo },
      })).count === 1;
      if (!gravou) {
        await this.registrarFalha(u, origem, 'mfa');
        throw new ErroHttp(401, MSG_MFA_INVALIDO);
      }
    } else if (entrada.codigoRecuperacao) {
      metodo = 'recuperacao';
      const usado = await this.prisma.codigoRecuperacaoMfa.updateMany({
        where: { usuarioId: u.id, codigoHash: this.hashRecuperacao(entrada.codigoRecuperacao), usadoEm: null },
        data: { usadoEm: new Date() },
      });
      if (usado.count !== 1) {
        await this.registrarFalha(u, origem, 'mfa');
        throw new ErroHttp(401, MSG_MFA_INVALIDO);
      }
      restantes = await this.prisma.codigoRecuperacaoMfa.count({ where: { usuarioId: u.id, usadoEm: null } });
      await this.auditar(u.id, 'MFA_RECUPERACAO_USADA', origem, { restantes });
    } else {
      throw new ErroRegra('Informe o código do autenticador ou um código de recuperação');
    }

    await this.prisma.usuario.update({ where: { id: u.id }, data: { tentativasFalhas: 0, bloqueadoAte: null } });
    this.falhasIp.limpar(origem.ip ?? 'desconhecido');
    const sessao = await this.criarSessao(u.id, origem);
    await this.auditar(u.id, 'LOGIN_SUCESSO', origem, { metodo });
    return { sessao, codigosRecuperacaoRestantes: restantes };
  }

  // ---------- Sessões ----------

  private async tokenAcesso(usuarioId: string, sessaoId: string) {
    return new SignJWT({ sid: sessaoId })
      .setProtectedHeader({ alg: ALG, typ: 'JWT' })
      .setSubject(usuarioId).setIssuer(EMISSOR).setAudience('api').setIssuedAt()
      .setExpirationTime(`${TEMPOS.acessoSeg}s`)
      .sign(this.chaveJwt);
  }

  private async criarSessao(usuarioId: string, origem: Origem): Promise<SessaoCriada> {
    const refresh = tokenAleatorio();
    const agora = Date.now();
    const s = await this.prisma.sessao.create({
      data: {
        usuarioId,
        refreshTokenHash: sha256(refresh),
        expiraEm: new Date(agora + TEMPOS.sessaoMaxMs),
        ultimoUsoEm: new Date(agora),
        ip: origem.ip?.slice(0, 45),
        userAgent: origem.userAgent?.slice(0, 300),
      },
    });
    return { acesso: await this.tokenAcesso(usuarioId, s.id), refresh, csrf: tokenAleatorio(), sessaoId: s.id };
  }

  /** Confere o token de acesso em toda requisição: assinatura, sessão ativa, inatividade e usuário ativo. */
  async validarAcesso(token: string | undefined): Promise<UsuarioLogado> {
    if (!token) throw new ErroHttp(401, 'Faça login para continuar');
    let sub: string, sid: string;
    try {
      const { payload } = await jwtVerify(token, this.chaveJwt, { algorithms: [ALG], issuer: EMISSOR, audience: 'api' });
      sub = String(payload.sub);
      sid = String(payload.sid);
    } catch {
      throw new ErroHttp(401, MSG_SESSAO);
    }
    const s = await this.prisma.sessao.findUnique({ where: { id: sid }, include: { usuario: true } });
    const agora = Date.now();
    if (
      !s || s.usuarioId !== sub || s.revogadoEm || s.expiraEm.getTime() <= agora
      || (s.ultimoUsoEm && agora - s.ultimoUsoEm.getTime() > TEMPOS.inatividadeMs)
      || !s.usuario.ativo || s.usuario.excluidoEm || !s.usuario.mfaAtivo
    ) {
      throw new ErroHttp(401, MSG_SESSAO);
    }
    if (!s.ultimoUsoEm || agora - s.ultimoUsoEm.getTime() > 60_000) {
      await this.prisma.sessao.update({ where: { id: s.id }, data: { ultimoUsoEm: new Date(agora) } });
    }
    return { usuario: s.usuario, sessaoId: s.id };
  }

  /** Troca o refresh token por um novo (rotação) e emite outro token de acesso. */
  async renovar(refresh: string | undefined): Promise<SessaoCriada> {
    if (!refresh) throw new ErroHttp(401, MSG_SESSAO);
    const novo = tokenAleatorio();
    const agora = new Date();
    const s = await this.prisma.sessao.findUnique({ where: { refreshTokenHash: sha256(refresh) }, include: { usuario: true } });
    if (
      !s || s.revogadoEm || s.expiraEm <= agora
      || (s.ultimoUsoEm && agora.getTime() - s.ultimoUsoEm.getTime() > TEMPOS.inatividadeMs)
      || !s.usuario.ativo || s.usuario.excluidoEm
    ) {
      throw new ErroHttp(401, MSG_SESSAO);
    }
    // Só troca se o token ainda for o atual: um refresh usado duas vezes falha na segunda
    const r = await this.prisma.sessao.updateMany({
      where: { id: s.id, refreshTokenHash: sha256(refresh), revogadoEm: null },
      data: { refreshTokenHash: sha256(novo), ultimoUsoEm: agora },
    });
    if (r.count !== 1) throw new ErroHttp(401, MSG_SESSAO);
    return { acesso: await this.tokenAcesso(s.usuarioId, s.id), refresh: novo, csrf: tokenAleatorio(), sessaoId: s.id };
  }

  async sair(sessaoId: string, usuarioId: string, origem: Origem) {
    await this.prisma.sessao.updateMany({ where: { id: sessaoId, revogadoEm: null }, data: { revogadoEm: new Date() } });
    await this.auditar(usuarioId, 'LOGOUT', origem);
  }

  async trocarSenha(u: Usuario, sessaoId: string, senhaAtual: string, novaSenha: string, origem: Origem) {
    if (!(await conferirSenha(u.senhaHash, senhaAtual))) {
      await this.registrarFalha(u, origem, 'troca_senha');
      throw new ErroRegra('Senha atual incorreta');
    }
    if (senhaAtual === novaSenha) throw new ErroRegra('A nova senha precisa ser diferente da atual');
    validarPoliticaSenha(novaSenha, { email: this.cripto.decifrar(u.emailCifrado) });
    const senhaHash = await hashSenha(novaSenha);
    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id: u.id }, data: { senhaHash, deveTrocarSenha: false } });
      await revogarSessoes(tx, u.id, sessaoId); // derruba as outras sessões abertas
      await this.auditar(u.id, 'SENHA_ALTERADA', origem, undefined, tx);
    });
  }

  // ---------- Apoio ----------

  hashRecuperacao(codigo: string) {
    return this.cripto.hmac(`recuperacao:${normalizarCodigoRecuperacao(codigo)}`);
  }

  /** 5 erros seguidos (senha ou MFA) bloqueiam por 15 min; cada novo bloqueio dobra o tempo, até 24 h. */
  private async registrarFalha(u: Usuario, origem: Origem, etapa: string) {
    this.falhasIp.registrar(origem.ip ?? 'desconhecido');
    const tentativas = u.tentativasFalhas + 1;
    let bloqueadoAte: Date | undefined;
    if (tentativas % TEMPOS.maxFalhas === 0) {
      const vezes = tentativas / TEMPOS.maxFalhas - 1;
      const ms = Math.min(TEMPOS.bloqueioBaseMs * 2 ** vezes, TEMPOS.bloqueioMaxMs);
      bloqueadoAte = new Date(Date.now() + ms);
    }
    await this.prisma.usuario.update({ where: { id: u.id }, data: { tentativasFalhas: { increment: 1 }, bloqueadoAte } });
    u.tentativasFalhas = tentativas;
    await this.auditar(u.id, 'LOGIN_FALHOU', origem, { etapa });
    if (bloqueadoAte) await this.auditar(u.id, 'USUARIO_BLOQUEADO_TENTATIVAS', origem, { ate: bloqueadoAte.toISOString() });
  }

  private async auditar(usuarioId: string | null, acao: string, origem: Origem, depois?: object, tx: Prisma.TransactionClient = this.prisma) {
    await tx.logAuditoria.create({
      data: {
        usuarioId, acao, entidade: 'usuarios', entidadeId: usuarioId, ip: origem.ip?.slice(0, 45) ?? null,
        valoresDepois: depois ?? Prisma.JsonNull,
      },
    });
  }
}
