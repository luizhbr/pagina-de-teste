# Agenda NFC — compartilhamento seguro (preparação)

**Estado:** proposta técnica em branch separada; a versão em `main` no Render CONTINUA local, funcionando sem alteração. Não publique este recurso até configurar e testar um banco independente.

## Objetivo

Permitir que membros autorizados da equipe Next Finish Carpentry usem uma agenda compartilhada e atualizada, sem perder os serviços e os clientes já salvos no navegador.

## Serviços preservados

- Interface Semana/Mês, primeiro dia domingo; iconografia NFC e PWA.
- Status: Concluído, Não fechado, Visita de orçamento, Em andamento e Aguardando confirmação.
- Clientes/autocomplete, SMS, cópia formatada, relatórios mensais e backup JSON.
- Mesma chave local: `agenda-nfc-public-v1`; nenhuma alteração automática na base do usuário.
- Link de produção: `https://next-finish-agenda.onrender.com/`.

## Segurança

1. Criar um projeto **novo e exclusivo para Next Finish Carpentry**. Não usar nenhum banco de outros projetos.
2. Usar Supabase Auth com login individual por email/OTP e confirmação de endereço. Não compartilhar senhas.
3. Executar `sync/supabase-schema.sql` SOMENTE no projeto novo, revisar as RLS, conceder permissão ao proprietário pelo ID verificado de `auth.users`, e convidar a equipe um membro por vez. Não aceitar cadastros externos sem vínculo em `nfc_team_members`.
4. Checar RLS com: usuário proprietário, funcionário convidado e usuário não convidado. Não habilitar realtime antes de verificar permissões.
5. Configurar no app APENAS `project URL` e `publishable` API key; **NUNCA publicar `service_role`, senhas, emails/endereços de clientes ou arquivos CSV no GitHub**.
6. Mesmo com autenticação remota, dados `localStorage` preexistentes permanecem neste dispositivo. Exigir bloqueio de tela e backup privado.

## Migração sem perda

1. **Antes de conectar**: no app, abrir `⋯ → Exportar backup completo (JSON)` e guardar o arquivo em local privado. O JSON inclui clientes e todos os agendamentos.
2. Garantir que a base remota esteja vazia ou consultar seu conteúdo primeiro.
3. Criar conta de administrador e confirmar vínculo em `nfc_team_members`.
4. Ler o JSON do navegador **sem limpar localStorage**.
5. `readLocalSnapshot()` lê uma cópia; `previewLocalImport()` calcula novidades e conflitos sem escrever.
6. Se houver conflito de ID com conteúdo diferente, **abortar** e solicitar resolução manual — nunca fazer overwrite automático.
7. Importar apenas os registros novos por `insert`; se a conexão falhar, recomeçar após nova comparação. Nenhum método de importação usa `upsert` para substituir um registro existente.
8. Verificar quantidades e conteúdo em dois dispositivos antes de habilitar modo compartilhado na agenda principal.
9. Para edições, usar `revision` em operações `update/delete`. Se o número mudou, bloquear alteração e exigir atualização. O trigger do banco incrementa revisões.
10. Manter o backup local para restauração em caso de falha ou exclusão acidental.

## Arquivos preparados

- `sync/supabase-schema.sql`: estrutura privada do banco, tabelas de equipe e dados, políticas RLS e revisão otimista.
- `sync/shared-sync.js`: adaptador opcional, sem configuração sensível; preview de migração, inserção que não sobrescreve, atualizações com controle de revisão e assinatura de mudanças.
- `sync/README.md`: este plano de integração.

## Etapas que AINDA faltam antes de usar o compartilhamento

- [ ] O usuário escolher/criar a organização do Supabase destinada à Next Finish Carpentry; confirmar qualquer custo informado.
- [ ] Criar projeto exclusivo; confirmar email da conta administradora.
- [ ] Aplicar SQL, cadastrar administrador e verificar RLS com usuários de teste.
- [ ] Criar tela de autenticação e conectá-la ao app; proteger acesso quando o modo compartilhado estiver ativo.
- [ ] Integrar adaptador com eventos de salvar, editar e excluir, e sincronização com Realtime; tratar offline/conflitos.
- [ ] Testar importação real com backup privado do usuário (não publicar dados em repositório).
- [ ] Testar dois celulares antes de colocar em produção e preservar opção de rollback.
- [ ] Revisão de segurança e fluxo de recuperação; só então aprovar e fazer merge do PR de rascunho em `main`.

> Importante: esses arquivos **não ativam** login ou sincronização por si só e **não alteram** o aplicativo publicado. Eles preparam a arquitetura segura para a próxima etapa.
