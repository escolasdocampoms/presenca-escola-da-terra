# Instalação da planilha e do Apps Script

Leva uns 10 minutos e é feita uma única vez.

## 1. Criar a planilha
1. No Google Drive da conta responsável, crie uma planilha em branco chamada **Presença Escola da Terra MS**.
2. Em **Arquivo → Configurações**, coloque o fuso horário **(GMT-04:00) Campo Grande**.

## 2. Colar o código
1. Na planilha, abra **Extensões → Apps Script**.
2. Apague o conteúdo do arquivo `Código.gs` e cole todo o conteúdo de [`Code.gs`](Code.gs).
3. Clique no ícone de disquete para salvar.
4. Em **Configurações do projeto** (engrenagem), coloque o fuso horário **America/Campo_Grande**.

## 3. Rodar a instalação
1. No topo do editor, escolha a função **setup** e clique em **Executar**.
2. O Google vai pedir autorização. Se aparecer "O Google não verificou este app", clique em **Avançado → Acessar (não seguro)**. O app é seu, e a autorização é só para ele mexer nesta planilha e enviar os códigos de login por e-mail.
3. Ao final, a planilha terá as abas **Pessoas, Encontros, Presencas, Equipe, Sessoes e Log**, e o seu e-mail já estará na aba **Equipe**.

## 4. Publicar como App da Web
1. Clique em **Implantar → Nova implantação**.
2. Em "Selecionar tipo", escolha **App da Web**.
3. Preencha:
   - **Executar como:** Eu
   - **Quem pode acessar:** **Qualquer pessoa**
4. Clique em **Implantar** e copie o endereço que termina em **/exec**.

> **Se a opção "Qualquer pessoa" não aparecer** (só "Qualquer pessoa na UFMS"), a conta institucional está bloqueada para acesso externo. Nesse caso, refaça os passos 1 a 4 com uma conta Gmail do projeto. O código é o mesmo.

## 5. Ligar o site ao Apps Script
Edite o arquivo [`assets/config.js`](../assets/config.js) no GitHub, troque `COLE_AQUI_A_URL_DO_APPS_SCRIPT` pelo endereço copiado e salve (commit).

Para testar, abra o endereço `/exec` numa **janela anônima**. Deve aparecer algo como `{"ok":true,"servico":"presenca-escola-da-terra",...}`.

## 6. Cadastrar a equipe
Na aba **Equipe**, uma linha por pessoa:

| email | nome | ativo | observacao |
|---|---|---|---|
| fulana@ufms.br | Fulana | sim | tutora de Sidrolândia |

Para tirar o acesso de alguém, troque `ativo` para `nao`. O acesso cai na hora.

## Quando o código for atualizado
Cole o novo `Code.gs`, salve e vá em **Implantar → Gerenciar implantações → lápis (editar) → Versão: Nova versão → Implantar**. Assim o endereço `/exec` continua o mesmo e o site não precisa mudar.

## O que não mexer
- Os nomes das abas e a primeira linha (cabeçalhos).
- As colunas `cpf_hash` e `token_hash`.
- As **Propriedades do script** (`CPF_PEPPER` e `QR_SECRET`). Se forem apagadas, o sistema deixa de reconhecer os CPFs já importados.
