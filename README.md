# Presença – Programa Escola da Terra MS

Registro de presença dos cursistas e tutores do curso de aperfeiçoamento **Escola da Terra** (UFMS · SED/MS · MEC), por **QR code dinâmico** e com **confirmação manual pela equipe**.

- **Cursista:** lê o QR do telão → digita o CPF → confirma. Sem login e sem instalar nada.
- **Equipe:** entra com e-mail + código recebido por e-mail (acesso por 30 dias) em [`equipe.html`](equipe.html).

## Como funciona

| Parte | Onde fica | O que faz |
|---|---|---|
| Site | GitHub Pages (este repositório) | Telas do cursista (`index.html`) e da equipe (`equipe.html`) |
| Servidor | Google Apps Script ([`apps-script/Code.gs`](apps-script/Code.gs)) | Confere CPF, valida o QR, grava presenças, login da equipe |
| Dados | Google Planilha | Pessoas, encontros, presenças, equipe e registro de ações |

Instalação: [`apps-script/INSTALACAO.md`](apps-script/INSTALACAO.md).

## Proteção de dados (LGPD)
- **Nenhum dado pessoal fica neste repositório.** Arquivos `.csv`/`.xlsx` são bloqueados pelo `.gitignore`.
- O **CPF completo nunca é gravado**: a planilha guarda só o CPF mascarado (`***.456.789-**`) e uma impressão digital (HMAC-SHA256 com chave secreta guardada no Apps Script).
- A tela do cursista nunca lista ninguém. Mostra só o primeiro nome, a inicial do sobrenome, o CPF mascarado e o município de quem digitou o próprio CPF.
- Toda ação da equipe fica registrada na aba **Log**.

## QR code dinâmico
O telão mostra um QR que muda a cada 30 segundos e vale por cerca de 2,5 minutos, só enquanto a chamada está aberta. Assim, a foto do QR mandada num grupo deixa de funcionar rapidamente. O código é gerado com uma chave secreta no servidor, então não dá para criar um QR válido por fora.

## No dia do encontro (equipe)
1. **Antes:** faça o login com antecedência (o acesso dura 30 dias). Confira se o encontro está cadastrado na aba **Encontros**.
2. **Chamada:** escolha o encontro, clique em **Abrir chamada** e depois em **Mostrar QR no telão**, no notebook ligado ao projetor.
3. **Quem não conseguir pelo celular:** na aba **Chamada**, busque a pessoa e use **Confirmar presença**, informando o motivo.
4. **Sem internet no local:** imprima a **lista para assinatura** e depois lance os marcados em lote como "Lista física assinada".
5. **Ao final:** clique em **Fechar chamada**.

O **Tempo Comunidade** de cada Roça é cadastrado como um encontro do tipo **TC** (10h) e lançado em lote.

## Frequência
Calculada por horas: presentes ÷ carga horária, somando Tempo Universidade e Tempo Comunidade. Mínimo de **75%**. A aba **Frequência** mostra três situações (em dia, em risco ou abaixo de 75%) e exporta uma planilha com P/F por encontro.

## Desenvolvimento e testes
```bash
node tests/teste-fluxo.js        # backend no simulador do Apps Script
node tests/teste-telas.js        # telas no navegador (requer Playwright)
```
Os testes usam apenas CPFs fictícios.
