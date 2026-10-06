/**
 * Termos de Uso e Política de Privacidade (LGPD), com versão.
 * Ao mudar qualquer texto, suba VERSAO_TERMOS: todos precisam aceitar de novo no próximo acesso.
 * Texto inicial preparado para revisão da Ameta (jurídico/encarregado de dados) antes do uso real.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { Contexto } from '../ordens/ordens.js';

export const VERSAO_TERMOS = '1.0';
export const DATA_TERMOS = '2026-10-06';

export interface Secao { titulo: string; paragrafos: string[] }

export const TERMOS_DE_USO: Secao[] = [
  {
    titulo: '1. O que é este sistema',
    paragrafos: [
      'O Controle Financeiro da Ameta Serviços é um sistema interno para acompanhar pedidos de compra (P.Os) e notas fiscais de serviço (NFS-e). O uso é restrito a pessoas autorizadas pela Ameta Serviços.',
    ],
  },
  {
    titulo: '2. Seu acesso',
    paragrafos: [
      'O acesso é pessoal e intransferível. Você é responsável por manter em sigilo a sua senha, o autenticador do celular e os códigos de recuperação.',
      'Não compartilhe a sua conta. Se perder o celular ou suspeitar que alguém usou o seu acesso, avise o administrador do sistema imediatamente.',
    ],
  },
  {
    titulo: '3. Uso permitido',
    paragrafos: [
      'Use o sistema apenas para as atividades da sua função na Ameta Serviços e dentro das permissões do seu perfil (Administrador, Operador ou Visualizador).',
      'É proibido tentar acessar informações ou funções fora do seu perfil, burlar os controles de segurança, copiar dados em massa sem autorização ou usar as informações para fins alheios à empresa.',
    ],
  },
  {
    titulo: '4. Registro das ações',
    paragrafos: [
      'Para segurança e controle, o sistema registra quem fez cada ação, quando e de qual endereço de rede (IP): entradas e saídas, tentativas que falharam, alterações em P.Os e ações administrativas. Esses registros podem ser consultados pelos administradores.',
    ],
  },
  {
    titulo: '5. Confidencialidade',
    paragrafos: [
      'Os dados de clientes, valores e notas fiscais são confidenciais e pertencem à Ameta Serviços. Não divulgue essas informações fora da empresa.',
    ],
  },
  {
    titulo: '6. Suspensão do acesso',
    paragrafos: [
      'O administrador pode bloquear ou excluir o acesso a qualquer momento, especialmente em caso de desligamento, mudança de função ou uso em desacordo com estes termos.',
    ],
  },
  {
    titulo: '7. Mudanças nestes termos',
    paragrafos: [
      'Estes termos podem ser atualizados. Quando isso acontecer, o sistema pedirá um novo aceite no seu próximo acesso.',
    ],
  },
];

export const POLITICA_DE_PRIVACIDADE: Secao[] = [
  {
    titulo: '1. Quem trata os seus dados',
    paragrafos: [
      'A Ameta Serviços é a controladora dos dados pessoais tratados neste sistema, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018, LGPD).',
    ],
  },
  {
    titulo: '2. Quais dados coletamos',
    paragrafos: [
      'Dados de cadastro: nome e e-mail, informados pelo administrador.',
      'Dados de acesso: senha (guardada apenas como hash, sem possibilidade de leitura), o segredo do autenticador e os códigos de recuperação (guardados cifrados ou como hash).',
      'Registros de uso: data e hora das ações, endereço IP, navegador usado e o que foi alterado.',
      'Cookies: apenas os necessários para manter a sua sessão e proteger contra fraudes. Não usamos cookies de propaganda nem de rastreamento.',
    ],
  },
  {
    titulo: '3. Para que usamos',
    paragrafos: [
      'Para identificar você no login, controlar o que cada perfil pode fazer, enviar o convite de acesso por e-mail, manter o histórico das P.Os e proteger o sistema contra acessos indevidos.',
      'A base legal é a execução das atividades da relação de trabalho ou de prestação de serviços com a Ameta Serviços e o legítimo interesse da empresa em manter a segurança e o controle das suas operações (art. 7º, incisos V e IX, da LGPD).',
    ],
  },
  {
    titulo: '4. Com quem compartilhamos',
    paragrafos: [
      'Os dados não são vendidos nem compartilhados para fins comerciais. Eles ficam em servidores contratados pela Ameta Serviços para hospedar o sistema e enviar e-mails, que só podem usá-los para prestar esse serviço. Podem ser fornecidos a autoridades quando a lei exigir.',
    ],
  },
  {
    titulo: '5. Como protegemos',
    paragrafos: [
      'Conexão protegida (HTTPS), login com senha forte e autenticador obrigatório, nome e e-mail cifrados no banco, controle de acesso por perfil e registro de auditoria.',
    ],
  },
  {
    titulo: '6. Por quanto tempo guardamos',
    paragrafos: [
      'Os dados de cadastro ficam enquanto o seu acesso existir. Os registros de auditoria e o histórico das P.Os são mantidos pelo prazo necessário para controle, cumprimento de obrigações legais e defesa da empresa, mesmo depois que o acesso for excluído.',
    ],
  },
  {
    titulo: '7. Seus direitos',
    paragrafos: [
      'Você pode pedir confirmação e acesso aos seus dados, correção de dados incompletos ou errados e as demais providências do art. 18 da LGPD, falando com o administrador do sistema ou com o encarregado de dados da Ameta Serviços.',
    ],
  },
  {
    titulo: '8. Mudanças nesta política',
    paragrafos: [
      'Esta política pode ser atualizada. Quando isso acontecer, o sistema pedirá um novo aceite no seu próximo acesso.',
    ],
  },
];

/** Grava o aceite da versão atual (data, versão e IP ficam também na auditoria). */
export async function aceitarTermos(prisma: PrismaClient, usuarioId: string, ctx: Contexto = {}) {
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: usuarioId }, data: { termosVersaoAceita: VERSAO_TERMOS, termosAceitosEm: new Date() } });
    await tx.logAuditoria.createMany({
      data: {
        usuarioId, ip: ctx.ip ?? null, acao: 'TERMOS_ACEITOS', entidade: 'usuarios', entidadeId: usuarioId,
        valoresAntes: Prisma.JsonNull, valoresDepois: { versao: VERSAO_TERMOS },
      },
    });
  });
}
