---
description: Analisa as alterações, roda os testes, escreve título e descrição, faz commit e push
argument-hint: "[observação opcional sobre a alteração]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git branch:*), Bash(node --test:*), Bash(rm .git/MENSAGEM_COMMIT.txt)
---

Faça o commit e o push das alterações atuais deste repositório. Observação do usuário (pode estar vazia): $ARGUMENTS

Siga as etapas na ordem. Se qualquer etapa falhar, pare, explique o que aconteceu e não continue.

1. **Levantar as alterações.** Rode `git status -sb`, `git diff`, `git diff --cached` e `git log --oneline -8`.
   - Sem nada para commitar e sem commits locais à frente do `origin`: avise que não há o que enviar e pare.
   - Sem nada para commitar, mas com commits à frente do `origin`: liste esses commits e pule para a etapa 6.
   - HEAD destacado (fora de uma branch) ou merge/rebase em andamento: pare e avise.

2. **Rodar os testes.** Execute `node --test "tests/*.test.cjs"`. Se algum falhar, mostre a falha e pare sem commitar.

3. **Escolher os arquivos.** Liste os arquivos alterados e os novos (não rastreados).
   - Inclua o que faz parte da alteração: código, testes, estilos, páginas e documentação.
   - Nunca inclua senhas, tokens, `.env`, credenciais, `node_modules`, arquivos temporários, nem PDFs ou planilhas com dados de vendas e clientes.
   - Se tiver dúvida sobre algum arquivo, pergunte antes.
   - Adicione os arquivos pelo nome, com `git add <arquivo> ...`. Não use `git add -A` nem `git add .`.

4. **Escrever o título e a descrição** seguindo a seção "Título e descrição do commit" do `CLAUDE.md`. Baseie-se no diff real e na observação do usuário, se houver. Se as alterações tratarem de assuntos sem relação entre si, faça um commit para cada assunto.

5. **Fazer o commit.** Grave a mensagem (título, linha em branco, descrição) no arquivo `.git/MENSAGEM_COMMIT.txt` com a ferramenta de escrita de arquivos. Assim acentos e aspas não quebram o comando. Depois:
   ```
   git commit -F .git/MENSAGEM_COMMIT.txt
   rm .git/MENSAGEM_COMMIT.txt
   ```
   Não use `--no-verify` nem `--amend`. Faça o commit na branch atual (o projeto trabalha direto na `main`).

6. **Fazer o push.** Rode `git push`. Se a branch ainda não tiver upstream, use `git push -u origin <branch>`.
   - Se o push for recusado porque o GitHub tem commits que não estão aqui, não force. Explique e pergunte se deve trazer as mudanças com `git pull --rebase` antes.
   - Nunca use `--force`.

7. **Relatório final**, em português:
   - branch e hash curto do commit;
   - título e descrição usados, cada um em um bloco de código;
   - arquivos incluídos e arquivos deixados de fora (com o motivo);
   - resultado dos testes e do push.
