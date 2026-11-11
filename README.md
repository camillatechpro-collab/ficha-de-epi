# Ficha de EPI

App simples para criar fichas de controle de entrega de EPI (NR-06) para os colaboradores e imprimir / salvar em PDF.

## Como usar

- Abra o `index.html` direto no navegador **ou** rode `node servidor.js` e acesse http://localhost:5181
- **+ Nova ficha**: nome do colaborador, função, data e os EPIs entregues (nome, descrição, CA, quantidade, data de entrega e data de recebimento).
- **Empresa (opcional)**: nome, CNPJ e logo aparecem no cabeçalho da ficha impressa. Os dados da última empresa usada já vêm preenchidos na próxima ficha.
- **Termo de responsabilidade**: texto padrão baseado na NR-06 e no art. 158 da CLT, editável em cada ficha. Confira com a redação vigente da norma.
- **Imprimir / PDF**: gera a ficha em A4 com coluna de assinatura por EPI, linhas em branco para entregas futuras e campos de assinatura. Para PDF, escolha "Salvar como PDF" na janela de impressão.

## Assinatura do colaborador na tela

1. Na ficha, clique em **✍️ Coletar assinatura** e entregue o celular ou tablet ao colaborador. No computador, ele assina com o mouse.
2. O colaborador vê os EPIs e o termo, marca que leu, digita o **CPF** e **assina com o dedo ou a caneta**. Se a ficha já tiver CPF, o digitado precisa ser igual.
3. Ao confirmar:
   - a data de recebimento vazia é preenchida;
   - os EPIs assinados ficam **travados**, sem edição;
   - nome, CPF e termo também ficam fixos;
   - é gerado um **código de verificação**, um resumo SHA-256 do que foi assinado.
4. Na ficha impressa aparecem a assinatura em cada EPI, o CPF e o registro com data, hora e código.

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

As fichas ficam salvas no próprio navegador (localStorage). Use **Fazer backup** para baixar um arquivo `.json` com tudo e **Restaurar backup** para carregar em outro computador ou navegador. Limpar os dados do navegador apaga as fichas.

## Arquivos

- `index.html` — telas
- `app.js` — lógica (cadastro, validação de CNPJ, impressão, backup)
- `style.css` — visual e layout de impressão
- `servidor.js` — servidor local opcional
- `atualizar-base-ca.js` — baixa a base do CAEPI e gera `data/cas.js`
- `data/cas.js` — base de CAs válidos (gerada automaticamente)
