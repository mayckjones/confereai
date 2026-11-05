# ConfereAI

Ferramentas de conferência da Farmácia do Trabalhador de Alagoas (conciliação Caixa × Cielo/PIX, recibos, precificação/etiquetas de preço). Site estático em HTML, CSS e JavaScript puro, sem build. Cada ferramenta fica em `ferramentas/<id>/` e é registrada em `ferramentas/registry.js` e no menu do `index.html`.

## Testes

```
node --test "tests/*.test.cjs"
```

Rode os testes depois de qualquer alteração em `ferramentas/` ou `js/`. Se algum falhar, informe a falha e não sugira commit.

## Título e descrição do commit ao final de toda alteração

Sempre que uma resposta alterar arquivos deste repositório, termine com o título e a descrição do commit, prontos para colar no GitHub Desktop (campos "Summary" e "Description"). Não precisa esperar o pedido. Se nada foi alterado na resposta, não inclua.

Formato:

**Título:**
```
<título>
```

**Descrição:**
```
<descrição>
```

Regras:

- Português do Brasil, linguagem simples, como nos commits anteriores.
- Título com até 72 caracteres, começando por verbo na 3ª pessoa do presente: "Adiciona", "Corrige", "Ajusta", "Remove", "Detecta". Diga o que muda para quem usa o programa, não o nome do arquivo.
- Descrição:
  1. Um parágrafo curto com o problema ou o motivo da alteração.
  2. Lista com "-" do que mudou, um item por mudança, do ponto de vista de quem usa a ferramenta.
  3. Última linha com o resultado dos testes (ex.: "Testes: 26 de 26 passando.").
- Inclua apenas o que foi realmente alterado e verificado. Se algo não foi testado, diga na descrição.
- Se a alteração mexer em mais de um assunto sem relação entre si, sugira um commit para cada assunto, com título e descrição próprios e a lista de arquivos de cada um.
- Commit e push ficam com o usuário, pelo GitHub Desktop. Só faça commit ou push quando ele pedir, por exemplo com o comando `/commit-push`.
