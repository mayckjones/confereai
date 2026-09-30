# Análise dos cartões magnéticos — 28/09/2026

## Fontes e regra de leitura

- `cartoes magneticos.pdf`: cadastro de 30 cartões, com códigos distintos para POS e TEF.
- `Relação de Vendas por Período.PDF`: registro, data, hora e **valor bruto da venda** no sistema. A finalização é genérica (`Cartao Mag`); esse arquivo sozinho não informa bandeira ou canal.
- `Lançamentos de Cartão Magnético por Data.PDF`: código e descrição do cartão, registro, quantidade de parcelas, valor de cada parcela, taxa, crédito líquido e NSU. As linhas de parcelas são somadas por loja, data, registro, NSU e cartão para formar a venda.
- `Vendas_cielo loja 1/3/4/5.pdf`: data, hora, estabelecimento, bandeira, modalidade, parcelas, valor bruto, taxa e líquido das vendas aprovadas. Esses relatórios não possuem uma coluna POS/TEF; o canal só pode vir do sistema.

O código `1X` significa cartão cadastrado para uma parcela; `2X - 3X`, para duas ou três. A coluna `Parc.` do lançamento mostra o número efetivo de parcelas. Uma venda pode fechar em valor e ainda ter o cartão ou a faixa de parcelas lançados incorretamente.

## Fechamento por loja

| Loja comercial (código no sistema) | Vendas na Relação | Linhas de parcelas | Bruto sistema e Lançamentos | POS no sistema | TEF no sistema | Cielo: vendas / bruto | Diferença sistema − Cielo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Loja 1 (1) | 73 | 76 | R$ 3.122,77 | 2 / R$ 383,27 | 71 / R$ 2.739,50 | 71 / R$ 2.739,50 | **R$ 383,27** |
| Loja 3 (3) | 54 | 68 | R$ 3.243,67 | 1 / R$ 4,99 | 53 / R$ 3.238,68 | 54 / R$ 3.243,67 | R$ 0,00 |
| Loja 4 (7) | 67 | 71 | R$ 2.521,55 | 1 / R$ 8,97 | 66 / R$ 2.512,58 | 66 / R$ 2.512,58 | **R$ 8,97** |
| Loja 5 (6) | 61 | 73 | R$ 3.655,64 | 14 / R$ 974,75 | 47 / R$ 2.680,89 | 63 / R$ 4.038,91 | **−R$ 383,27** |
| **Quatro lojas** | **255** | **288** | **R$ 12.543,63** | **18 / R$ 1.371,98** | **237 / R$ 11.171,65** | **254 / R$ 12.534,66** | **R$ 8,97** |

A Relação e os Lançamentos fecham exatamente por loja, em quantidade de vendas e bruto. O PDF interno completo também inclui a loja 2: 50 vendas, 59 linhas e R$ 2.819,76. Não foi fornecido extrato Cielo dessa loja; o programa continua a excluí-la da comparação Cielo. Nas cinco lojas, o total interno é 305 vendas, 347 linhas e R$ 15.363,39.

## Pendências objetivas

1. **Loja 1: duas vendas POS sem correspondência segura no extrato da própria loja.** Registro `1227265`, R$ 308,29, `POS VISA 2X - 3X`, às 22:34; registro `1227266`, R$ 74,98, `POS MASTER DÉBITO`, às 22:35. O total de R$ 383,27 explica integralmente a diferença da loja. O primeiro registro tem `Parc. 1`, incompatível com a faixa de 2–3 parcelas do cartão selecionado.
2. **Loja 5: duas vendas adicionais na Cielo, R$ 308,29 e R$ 74,98.** Aparecem às 22:28 como crédito Visa em 3x e às 22:20 como débito Mastercard. Valores, bandeiras e modalidades se parecem com as duas pendências POS da loja 1, e a soma é igual. Isso sugere uso do estabelecimento da loja 5 em transações lançadas na loja 1, mas o PDF Cielo não traz NSU/terminal nem POS/TEF para confirmar a identidade. Além disso, o lançamento de R$ 308,29 na loja 1 informa `Parc. 1`, enquanto a Cielo informa 3x. Conferir os comprovantes dessas duas operações antes de corrigir loja ou cartão.
3. **Loja 4: uma venda POS sem correspondência no extrato.** Registro `3859`, R$ 8,97, `POS MASTER DÉBITO`, às 19:16. Esse valor explica a diferença residual de R$ 8,97 entre as quatro lojas.
4. **Vínculos apenas por data e valor:** um POS da loja 3 (registro `791869`, R$ 4,99) e 14 POS da loja 5 têm horários Cielo distantes. O valor bruto pode fechar, mas não há prova suficiente para afirmar que a linha Cielo selecionada é a mesma venda. Na loja 3, por exemplo, o registro é às 11:41 e a linha Cielo candidata às 14:46.

Nos pares vinculados com mesma data e valor e horário até dois minutos, a leitura atualizada mostra **35 diferenças de bandeira** (lojas 1/3/4/5: 13/13/6/3) e **20 diferenças débito × crédito** (10/2/0/8). Separadamente, há **14 vendas com parcelas fora da faixa do cartão cadastrado** (2/3/1/8), inclusive uma sem correspondência segura na Cielo. Uma venda pode aparecer em mais de uma contagem. Exemplos: `1227123` foi lançado como `TEF MASTER 1X` e consta na Cielo como débito Mastercard; `1227128` foi lançado como Mastercard e consta como crédito Visa; `1227124` foi lançado em 2x usando o cartão `TEF MASTER 1X`. Essas diferenças não alteram necessariamente o bruto, mas afetam a classificação e a conferência do recebimento.

## Atualização no ConfereAI

O leitor reconhece os 30 códigos e descrições do novo cadastro, incluindo `MASTER`, `HIPERC`, `CABAL` e `AMEX`; distingue POS/TEF, débito/crédito e a faixa cadastrada de parcelas. Preserva o número efetivo da coluna `Parc.` e sinaliza código/descrição incompatíveis ou parcelas fora da faixa. A conferência mostra o canal e código do cartão, soma o bruto interno por POS/TEF e inclui essas informações na planilha de detalhes.

A conciliação entre Relação e Cielo permanece por loja/estabelecimento. O sistema não atribui automaticamente a uma loja vendas que aparecem em outro extrato, nem confirma bandeira ou modalidade quando o vínculo depende apenas de data e valor. As taxas e líquidos do PDF Cielo descrevem as vendas aprovadas; eles não comprovam, por si, o depósito bancário.
