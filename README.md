# Ficha de EPI

App simples para criar fichas de controle de entrega de EPI (NR-06) para os colaboradores e imprimir / salvar em PDF.

## Como usar

- Abra o `index.html` direto no navegador **ou** rode `node servidor.js` e acesse http://localhost:5181
- **+ Nova ficha**: nome do colaborador, função, data e os EPIs entregues (nome, descrição, CA, quantidade, data de entrega e data de recebimento).
- **Empresa (opcional)**: nome, CNPJ e logo aparecem no cabeçalho da ficha impressa. Os dados da última empresa usada já vêm preenchidos na próxima ficha.
- **Termo de responsabilidade**: texto padrão baseado na NR-06 e no art. 158 da CLT, editável em cada ficha. Confira com a redação vigente da norma.
- **Imprimir / PDF**: gera a ficha em A4 com coluna de assinatura por EPI, linhas em branco para entregas futuras e campos de assinatura. Para PDF, escolha "Salvar como PDF" na janela de impressão.

## Gestão de EPIs

- **📊 Painel**: mostra:
  - colaboradores ativos;
  - trocas atrasadas e trocas dos próximos 15 dias;
  - EPIs do kit ainda pendentes;
  - fichas aguardando assinatura;
  - estoque baixo;
  - CAs vencidos entre os EPIs em uso.

  O botão **Nova entrega com esses EPIs** abre a ficha já preenchida.
- **👥 Colaboradores**:
  - cadastro com nome, CPF, função, setor, matrícula e admissão;
  - a página de cada colaborador mostra os EPIs em uso, a próxima troca, o kit pendente e o histórico de entregas;
  - quem saiu da empresa pode ser marcado como inativo;
  - a ficha cadastra o colaborador sozinha ao ser salva, e os nomes que já estão nas fichas podem ser importados.
- **🦺 EPIs**:
  - catálogo da empresa: o nº do CA preenche o nome e a descrição pela base do CAEPI;
  - **vida útil** em dias, usada para calcular as trocas;
  - **estoque**: estoque mínimo, saldo inicial, entradas (ex.: nota fiscal) e saídas/ajustes. As entregas das fichas descontam o estoque automaticamente a partir da data em que o EPI foi cadastrado.
- **Kit por função**: em Funções › *EPIs da função*, marque quais EPIs cada função recebe e em que quantidade. Na ficha, o botão **🦺 EPIs da função** adiciona todos de uma vez.
- **Devolução**: em cada EPI da ficha há o botão *Registrar devolução*. O EPI devolvido sai da lista "em uso" e, se fizer parte do kit, aparece como pendente de reposição.
- **App instalável**: quando o app é aberto pelo endereço da internet (GitHub Pages, por exemplo), dá para instalá-lo no celular ou no computador pelo botão *📲 Instalar app* do Painel. Depois do primeiro acesso, ele funciona sem internet.

## Funções da empresa

No menu **👷 Funções**, cadastre as funções existentes na empresa, com setor opcional. Na ficha, o campo **Função** sugere essas funções enquanto você digita. Se digitar uma função nova, aparece o atalho **＋ salvar na lista de funções**. A tela também mostra as funções já usadas nas fichas que ainda não estão na lista e permite adicioná-las de uma vez.

## Lixeira

Excluir uma ficha a move para a **🗑️ Lixeira**, onde ela fica por **30 dias**. Lá você pode **restaurar** a ficha, com as assinaturas, ou **excluir de vez**. Depois de 30 dias ela é apagada automaticamente. O número ao lado de "Lixeira" no menu mostra quantas fichas estão lá.

## Assinatura do colaborador e do responsável na tela

1. Na ficha, clique em **✍️ Coletar assinaturas** e entregue o celular ou tablet ao colaborador. No computador, ele assina com o mouse.
2. O colaborador vê os EPIs e o termo, marca que leu, digita o **CPF** e **assina com o dedo ou a caneta**. Se a ficha já tiver CPF, o digitado precisa ser igual.
3. Em seguida, o **responsável pela entrega** informa o nome e o cargo (opcional) e assina no segundo quadro. O nome e o cargo ficam guardados para a próxima vez.
4. Ao confirmar:
   - a data de recebimento vazia é preenchida;
   - os EPIs assinados ficam **travados**, sem edição;
   - nome, CPF e termo também ficam fixos;
   - é gerado um **código de verificação**, um resumo SHA-256 do que foi assinado.
5. Na ficha impressa aparecem a assinatura do colaborador em cada EPI, as duas assinaturas no final, o CPF e o registro com data, hora, responsável e código.

Para uma nova entrega, adicione os EPIs e colete outra assinatura. Só os itens novos são assinados. Para corrigir algo já assinado, remova a assinatura (os itens voltam a ser editáveis) e colete de novo.

## Preenchimento automático pelo CA

Ao digitar o nº do CA na ficha, o app preenche o nome do EPI e a descrição. Ele também mostra a validade e o fabricante, com alerta se o CA não estiver na base de válidos ou vencer antes da data de entrega. O que você digitar à mão nesses campos não é substituído.

Se você não souber o CA, digite o nome no campo **EPI** (ex.: "luva vaqueta", "botina bico"). Aparece uma lista de CAs válidos com fabricante e validade. Escolha com o mouse ou com as setas + Enter.

A base fica em `data/cas.js` e contém **somente os CAs válidos**, tirados da base pública do CAEPI (Ministério do Trabalho). Para atualizar:

```
node atualizar-base-ca.js
```

O script baixa a base oficial (cerca de 8 MB) e gera de novo o `data/cas.js`. Ele usa só o `curl` e o `tar` que já vêm no Windows. O governo não atualiza essa base todo dia, então a data dela aparece na tela. Em caso de dúvida, confirme no site do CAEPI.

## Dados

As fichas ficam salvas no próprio navegador (localStorage). Use **Fazer backup** para baixar um arquivo `.json` com tudo (fichas, colaboradores, EPIs, estoque, funções e lixeira) e **Restaurar backup** para carregar em outro computador ou navegador. Limpar os dados do navegador apaga as fichas.

## Arquivos

- `index.html` — telas
- `app.js` — fichas, assinaturas, CA, impressão, funções, lixeira e backup
- `gestao.js` — painel, colaboradores, catálogo de EPIs, estoque, kit por função e trocas
- `sw.js` e `manifest.webmanifest` — app instalável e funcionamento offline (ao publicar uma versão nova, troque `VERSAO` no `sw.js`)
- `style.css` — visual e layout de impressão
- `servidor.js` — servidor local opcional
- `atualizar-base-ca.js` — baixa a base do CAEPI e gera `data/cas.js`
- `data/cas.js` — base de CAs válidos (gerada automaticamente)
