export type Perfil = 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR';
export type Status = 'AGUARDANDO_LIBERACAO' | 'EMITIR_NOTA' | 'EM_EXECUCAO' | 'EMITIDA' | 'CANCELADO';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  mfaAtivo: boolean;
  bloqueadoAte: string | null;
  deveTrocarSenha: boolean;
  /** false = ainda não aceitou o convite do e-mail (não consegue entrar) */
  conviteAceito: boolean;
  conviteExpiraEm: string | null;
  criadoEm: string;
}

export interface Item {
  id: string;
  ordemCompraId: string;
  numeroPo: string;
  item: string | null;
  idSite: string | null;
  site: string | null;
  fase: string | null;
  tecnologia: string | null;
  projeto: string | null;
  uf: string | null;
  operadora: string | null;
  valorOriginal: string | null;
  percentualMulta: string | null;
  possuiMulta: boolean;
  status: Status;
  statusOrigem: string | null;
  numeroNfse: string | null;
  dataEmissao: string | null;
  numeroMigo: string | null;
  observacoes: string | null;
  criadoEm: string;
  atualizadoEm: string;
  excluidoEm: string | null;
  rotuloStatus: string;
  statusFinanceiro: 'FECHADO' | 'ENTREGUE' | 'NOVO';
  valorFinal: string;
  valorMulta: string;
}

export interface Historico {
  id: string;
  statusDe: Status | null;
  statusPara: Status;
  possuiMulta: boolean;
  motivo: string | null;
  criadoEm: string;
  rotuloDe: string | null;
  rotuloPara: string;
  usuarioNome: string | null;
}

export interface DetalhePo {
  id: string;
  numeroPo: string;
  criadoEm: string;
  itens: (Item & { historico: Historico[] })[];
}

export interface Pagina<T> {
  total: number;
  pagina: number;
  porPagina: number;
  itens: T[];
}

export type Contadores = Record<Status, number> & { EMITIDA_COM_MULTA: number; EMITIDA_SEM_MULTA: number };

export interface RegistroAuditoria {
  id: string;
  usuarioId: string | null;
  usuarioNome: string | null;
  /** Em quem a ação foi feita: "P.O 4533312225 · item 10" ou o nome do usuário */
  alvo: string | null;
  acao: string;
  entidade: string | null;
  entidadeId: string | null;
  ip: string | null;
  valoresAntes: unknown;
  valoresDepois: unknown;
  criadoEm: string;
}

export const STATUS: { valor: Status; rotulo: string; caminho: string }[] = [
  { valor: 'AGUARDANDO_LIBERACAO', rotulo: 'Aguardando Liberação', caminho: '/aguardando-liberacao' },
  { valor: 'EMITIR_NOTA', rotulo: 'Emitir Nota', caminho: '/emitir-nota' },
  { valor: 'EM_EXECUCAO', rotulo: 'Em Execução', caminho: '/em-execucao' },
  { valor: 'EMITIDA', rotulo: 'Emitidas', caminho: '/emitidas' },
  { valor: 'CANCELADO', rotulo: 'Canceladas', caminho: '/canceladas' },
];

export const ROTULO_STATUS: Record<Status, string> = {
  AGUARDANDO_LIBERACAO: 'Aguardando Liberação',
  EMITIR_NOTA: 'Emitir Nota',
  EM_EXECUCAO: 'Em Execução',
  EMITIDA: 'Emitida',
  CANCELADO: 'Cancelado',
};

export const ITENS_PERMITIDOS = ['10', '20', '30', '40', '50', '10 20', '10 20 30', '10 20 30 40', '10 20 30 40 50'];
export const OPERADORAS = ['CLARO', 'VIVO', 'AT&T'];
export const ROTULO_PERFIL: Record<Perfil, string> = { ADMIN: 'Administrador', OPERADOR: 'Operador', VISUALIZADOR: 'Visualizador' };
