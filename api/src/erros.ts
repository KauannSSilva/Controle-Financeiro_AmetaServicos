/** Erros de regra de negócio. A API traduz cada um para um código HTTP com a mensagem em português. */

/** Dado inválido ou operação não permitida pela regra (HTTP 422). */
export class ErroRegra extends Error {}

/** Registro não existe ou foi removido (HTTP 404). */
export class ErroNaoEncontrado extends ErroRegra {}

/** Alguém alterou o registro antes de você (HTTP 409). */
export class ErroConflito extends ErroRegra {}

/** Erro com código HTTP próprio (login, sessão, permissão). */
export class ErroHttp extends Error {
  constructor(public readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

export const MSG_LOGIN_INVALIDO = 'E-mail ou senha inválidos';
export const MSG_MFA_INVALIDO = 'Código inválido ou expirado';
export const MSG_BLOQUEADO = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
export const MSG_SESSAO = 'Sessão expirada. Entre de novo.';
export const MSG_CONVITE_PENDENTE = 'Aceite o convite enviado para o seu e-mail antes de entrar.';
