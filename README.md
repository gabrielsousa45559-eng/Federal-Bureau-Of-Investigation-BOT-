# Bot Discord — Central de Operações

Bot para comunidade temática do **Federal Bureau of Investigation (FBI)**, em Node.js 20+ e discord.js 14, com aprovação por botões, painéis com modais, tickets privados, ações com lista de presença e auditoria local em SQLite. Os prints da Polícia Federal foram usados como referência de interface e fluxo; a marca padrão do bot é FBI.

## Instalação

1. Instale Node.js 20 ou mais recente.
2. Nesta pasta, execute `npm install`.
3. Copie `.env.example` para `.env` e preencha `DISCORD_TOKEN`, `CLIENT_ID` e `GUILD_ID`.
4. No [Discord Developer Portal](https://discord.com/developers/applications), mantenha o token em segredo. A versão atual não solicita intents privilegiados.
5. Convide o bot com os escopos `bot` e `applications.commands`. Conceda apenas permissões necessárias: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels, Manage Roles, Ban Members e Moderate Members. Posicione o cargo do bot acima dos cargos que ele precisa gerenciar.
6. Execute `npm run deploy` e depois `npm start`. No Windows, use `Deploy-Commands.bat` e `Start.bat`.

Atalhos: `Start.bat` inicia o bot; `Deploy-Commands.bat` publica os comandos slash; `npm run panels` atualiza os painéis nos canais configurados; `Upload-to-GitHub.bat` prepara um commit, pede confirmação e envia ao repositório configurado. O upload verifica que `.env` está ignorado e não o inclui.

O registro dos comandos em `GUILD_ID` costuma aparecer rapidamente no servidor de desenvolvimento. Para publicar globalmente, remova `GUILD_ID` do ambiente e rode `npm run deploy` novamente.

## Preparação no servidor

1. Crie os canais de solicitação e análise de promoções, análise de registros, divulgação, quarentena, ausências e auditoria; crie uma categoria comum para tickets e os cargos base FBI, Agente Especial Probatório, Agente de Campo Níveis 1–3, Agente Especial Nível 1, equipe, aprovação, advertências, afastamento e exonerado.
2. Configure destinos com `/configurar`. Para cadastrar aprovadores, use a opção **Cargo de aprovação** e informe o cargo no campo `aprovador`.
3. Publique os painéis com `/painel`: registro, promoção, tickets, disciplina e ausência. `/painel tipo:Solicitar promoção` vai para `PROMOTION_REQUEST_CHANNEL_ID`; `/painel tipo:Ausência` vai para `ABSENCE_REQUEST_CHANNEL_ID`. Esses painéis são públicos e utilizáveis por todos. `/acao` publica no canal atual (ou no canal opcional indicado), sem aprovação.
4. O painel de promoção é publicado no canal de solicitação configurado; pedidos seguem para o canal separado de análise. O formulário de ausência publica cada envio tanto no canal de solicitações quanto no canal de registros, sem aprovação. `/ausencia` abre o mesmo formulário. No registro, a pessoa escolhe Agente Especial Probatório, Agente de Campo Nível 1/2/3 ou Agente Especial Nível 1. A aprovação aplica o cargo base `1568855376605085706`, o cargo escolhido e define o apelido no formato `[AGT.1] Nome | ID`.
5. Membros abrem tickets pelo painel ou `/ticket categoria:...`; o bot cria canais dentro da categoria comum configurada. A equipe usa os botões **Assumir**, **Revogar atribuição** e **Encerrar**.

O canal `PROMOTION_REQUEST_CHANNEL_ID` recebe o painel público de solicitação de promoção; `PROMOTION_REVIEW_CHANNEL_ID` recebe os pedidos para análise da equipe. O ID de solicitação informado foi preenchido no `.env` como `1568855463926177794`. Para ausência, configure separadamente `ABSENCE_REQUEST_CHANNEL_ID` (solicitações) e `ABSENCE_CHANNEL_ID` (registro).

## Comandos

| Comando | Uso |
|---|---|
| `/configurar` | Define canal, categoria, cargo ou cargo aprovador. |
| `/painel` | Publica painel de registro, promoção, tickets ou disciplina. |
| `/acao` | Publica nome, horário e contingente, com lista de presença e sem aprovação. |
| `/ausencia` | Abre o formulário de ausência; qualquer membro pode usar. |
| `/advertir membro` | Abre medida disciplinar para advertência, afastamento ou exoneração. |
| `/ticket categoria` | Abre canal privado de atendimento. |
| `/fechar-ticket` | Fecha o ticket atual. |
| `/logs quantidade` | Consulta auditoria recente (equipe com acesso ao log de auditoria). |

## Quarentena e segurança

O ban automático funciona **somente** no canal explicitamente configurado como quarentena. O ID `1569085763436675314` já está preenchido no `.env.example`. Qualquer membro que enviar mensagem ali será banido, e o Discord será instruído a apagar as mensagens dessa conta dos últimos 60 minutos. Restrinja o acesso ao canal a moderadores e contas sob revisão. O bot não tenta classificar nem banir pessoas por conteúdo fora desse canal. O evento, o autor, o texto e URLs de anexos são registrados no canal de logs, caso configurado. A exclusão depende da permissão Ban Members e dos limites da API do Discord.

Advertências passam por análise e têm cargos separados: nível 1 dura de 1 a 3 dias; nível 2, de 3 a 10 dias; nível 3 aplica afastamento por 7 dias. Configure `WARNING1_ROLE_ID`, `WARNING2_ROLE_ID` e `WARNING3_ROLE_ID`; se algum estiver vazio, o bot usa `WARNING_ROLE_ID` como fallback. O cargo temporário é removido automaticamente no vencimento, inclusive após reinício do bot. A exoneração remove cargos não gerenciados pelo Discord que estejam abaixo do cargo do bot e aplica o cargo de exonerado configurado. Cargos acima do bot não podem ser alterados pela API. A configuração de permissões do servidor ainda pode deixar canais visíveis: revise overwrites e acesso de cargos exonerados.

Os dados de solicitações, tickets e ações ficam em `data/bot.sqlite`. Faça backup desse arquivo. `DISCORD_TOKEN` deve permanecer somente no `.env`, que não deve ser enviado ao Git.

## Limites atuais

- O comando `/acao` publica no canal em que for usado, a menos que se indique um canal de divulgação.
- Ausências são registradas no canal configurado em `ABSENCE_CHANNEL_ID`.
- A presença pede o passaporte da pessoa no modal e também registra o ID de Discord.
- Os painéis são publicados como mensagens novas; execute `/painel` novamente para republicar.
- A arte do selo FBI anexada é usada como miniatura dos painéis e tickets.
- `npm run start:win` inicia o bot no Windows; `npm start` é equivalente.
- Recurso de punição abre ticket privado; a decisão do recurso é conduzida pela equipe no próprio ticket.
- O template de cargos da imagem é ilustrativo. Os cargos reais precisam existir no servidor e ser fornecidos nas solicitações.
