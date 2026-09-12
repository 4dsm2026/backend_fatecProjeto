# Plano de Testes

## Novas Funcionalidades 2

### Caixa de Sugestões

Sistema de Secretaria Acadêmica - Workflow  
FATEC Cotia  
Equipe de QA

Versão 1.0 \| Setembro de 2026

# 1. Introdução

Este documento formaliza a solicitação e o roteiro de execução dos testes da funcionalidade Caixa de Sugestões, incluída na branch Novas-Funcionalidades_2 do Sistema de Secretaria Acadêmica. O objetivo é verificar se os fluxos do aluno e da equipe administrativa atendem às regras implementadas e podem ser executados de forma clara, repetível e documentada pela equipe de UX.

Os casos foram definidos a partir das telas e regras do frontend e das validações, permissões e regras de negócio do backend. Cada caso contém pré-condições, massa de dados, passos, resultados esperados e campos para resultado obtido, status e evidência.

# 2. Escopo

- Envio de sugestão, elogio ou crítica por aluno autenticado.

- Validação de e-mail, conteúdo obrigatório e limites de caracteres.

- Listagem, ordenação, paginação e consulta de detalhes.

- Privacidade: aluno visualiza somente as próprias sugestões.

- Listagem e filtro administrativo por status.

- Resposta por perfis autorizados e mudança de status.

- Imutabilidade da resposta salva e do status Respondido.

# 3. Fluxo geral da funcionalidade

## 3.1 Fluxo do aluno

1. O aluno acessa o sistema autenticado.

2. Entra na opção “Caixa de Sugestões” pelo menu lateral.

3. Informa um e-mail para contato.

4. Escreve uma sugestão, elogio ou crítica.

5. Clica em “Enviar”.

6. O sistema registra a sugestão com o status “Não respondido”.

7. A sugestão aparece na listagem do próprio aluno.

8. O aluno pode abrir o registro para acompanhar o status.

9. Quando a equipe administrativa responder, o status será alterado para “Respondido”.

10. O aluno pode visualizar a resposta e, quando disponível, o nome do responsável.

## 3.2 Fluxo da equipe administrativa

1. O funcionário acessa o sistema com um perfil autorizado.

2. Entra na opção “Caixa de Sugestões”.

3. Visualiza as sugestões enviadas pelos alunos.

4. Pode filtrar os registros por “Não respondido” ou “Respondido”.

5. Abre uma sugestão para consultar o conteúdo, o nome, o R.A. e o e-mail do aluno.

6. Escreve uma resposta e salva.

7. A resposta salva não pode mais ser editada.

8. O funcionário altera o status para “Respondido”.

9. Após a alteração, a resposta e o status ficam definitivamente bloqueados.

10. A resposta passa a ficar disponível para o aluno.

**Observação:** somente os perfis Administrador, Backoffice e Técnico podem responder às sugestões. O aluno visualiza apenas os registros vinculados ao próprio cadastro.

# 4. Dados para execução dos testes

Os testes serão executados e gravados pela equipe de UX. As contas abaixo devem possuir os dados necessários para os cenários descritos neste documento.

| Dados da execução | Preenchimento |
|---|---|
| **Conta de aluno 1** | ________________________________________________ |
| **Conta de aluno 2** | ________________________________________________ |
| **Conta administrativa** | Perfil: [ ] ADMINISTRADOR [ ] BACKOFFICE [ ] TECNICO / Identificação: ______________________________ |
| **Data da execução** | ____/____/______ |
| **Executor de UX** | ________________________________________________ |

# 5. Critérios gerais

Aprovado: todos os resultados esperados foram observados e registrados. Falhou: ao menos um resultado divergiu, ocorreu erro inesperado, houve exposição indevida de dados ou perda/truncamento de informação. Bloqueado: o teste não pôde ser concluído por indisponibilidade do ambiente, acesso ou massa de dados. Toda falha deve conter evidência e descrição objetiva do comportamento observado.

# 6. Técnicas aplicadas

| **Técnica**                 | **Aplicação**                                                                  | **Casos relacionados** |
|-----------------------------|--------------------------------------------------------------------------------|------------------------|
| **Caixa-preta**             | Execução pela interface, considerando entradas e saídas observáveis.           | Todos                  |
| **Classes de equivalência** | E-mails válidos/inválidos; conteúdo vazio/válido; perfis aluno/staff.          | 03, 04, 05, 09, 18     |
| **Valores-limite**          | Mínimo de 3 e máximo de 1.000 caracteres na sugestão; 500 na tela de resposta. | 05, 06, 17             |
| **Cobertura de caminhos**   | Criação, consulta, filtro, resposta parcial, finalização e bloqueios.          | 02, 08, 12, 14, 15, 16 |
| **Permissões**              | Separação entre dados de alunos e ações administrativas.                       | 09, 11, 18             |

# 7. Matriz resumida de casos

| **ID**        | **Cenário**                                                | **Tipo**                                     | **Prioridade** |
|---------------|------------------------------------------------------------|----------------------------------------------|----------------|
| **CT-NF2-01** | Acessar a Caixa de Sugestões como aluno                    | Caixa-preta / caminho principal              | Alta           |
| **CT-NF2-02** | Enviar sugestão com dados válidos                          | Funcional positivo                           | Crítica        |
| **CT-NF2-03** | Impedir envio sem e-mail                                   | Funcional negativo / campo obrigatório       | Alta           |
| **CT-NF2-04** | Impedir envio com e-mail inválido                          | Funcional negativo / formato                 | Alta           |
| **CT-NF2-05** | Validar tamanho mínimo da sugestão                         | Valor-limite / negativo e positivo           | Alta           |
| **CT-NF2-06** | Validar tamanho máximo da sugestão                         | Valor-limite                                 | Alta           |
| **CT-NF2-07** | Preservar acentos, caracteres especiais e quebras de linha | Cobertura de inputs                          | Média          |
| **CT-NF2-08** | Consultar detalhe de sugestão não respondida               | Funcional positivo                           | Alta           |
| **CT-NF2-09** | Restringir acesso do aluno à sugestão de outro usuário     | Permissão / negativo                         | Crítica        |
| **CT-NF2-10** | Paginar sugestões do aluno                                 | Fluxo alternativo                            | Média          |
| **CT-NF2-11** | Listar sugestões no perfil administrativo                  | Funcional positivo / permissão               | Crítica        |
| **CT-NF2-12** | Filtrar sugestões por status                               | Caminhos / filtros                           | Alta           |
| **CT-NF2-13** | Abrir detalhe administrativo                               | Funcional positivo                           | Alta           |
| **CT-NF2-14** | Salvar resposta mantendo status “Não respondido”           | Regra de negócio / caminho alternativo       | Crítica        |
| **CT-NF2-15** | Finalizar sugestão como respondida                         | Regra de negócio / ponta a ponta             | Crítica        |
| **CT-NF2-16** | Impedir alteração após status “Respondido”                 | Regra de negócio / negativo                  | Crítica        |
| **CT-NF2-17** | Validar limite da resposta administrativa                  | Valor-limite / compatibilidade entre camadas | Alta           |
| **CT-NF2-18** | Impedir aluno de responder sugestão                        | Permissão / negativo                         | Crítica        |

# 8. Casos de teste detalhados

## CT-NF2-01 - Acessar a Caixa de Sugestões como aluno

| **Funcionalidade**    | Navegação e carregamento da área do aluno                                                                         |
|-----------------------|-------------------------------------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Caixa-preta / caminho principal \| Alta                                                                           |
| **Objetivo**          | Validar se o aluno autenticado consegue abrir a funcionalidade e visualizar corretamente seus elementos iniciais. |
| **Pré-condições**     | Aluno autenticado; perfil com R.A. cadastrado; conexão ativa; pelo menos um registro próprio é opcional.          |
| **Dados de teste**    | Não se aplica.                                                                                                    |

| **\#** | **Ação do executor**                                                  | **Resultado esperado**                                                                                            |
|--------|-----------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| **1**  | No menu lateral do aluno, localizar e clicar em “Caixa de Sugestões”. | A página “Caixa de Sugestões” é aberta sem erro.                                                                  |
| **2**  | Observar o formulário “Nova sugestão”.                                | São exibidos o R.A. do aluno, os campos obrigatórios “E-mail” e “Sugestão”, o contador 0/1000 e o botão “Enviar”. |
| **3**  | Observar a seção “Sugestões enviadas”.                                | A lista mostra somente sugestões do aluno autenticado ou a mensagem “Você não enviou nenhuma sugestão.”           |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-02 - Enviar sugestão com dados válidos

| **Funcionalidade**    | Cadastro de sugestão pelo aluno                                                                                       |
|-----------------------|-----------------------------------------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Funcional positivo \| Crítica                                                                                         |
| **Objetivo**          | Confirmar o cadastro de uma sugestão válida e sua inclusão na listagem do aluno.                                      |
| **Pré-condições**     | Aluno autenticado e na página “Caixa de Sugestões”.                                                                   |
| **Dados de teste**    | E-mail: maria.qa@fatec.sp.gov.br \| Sugestão: Disponibilizar mais horários para atendimento presencial na secretaria. |

| **\#** | **Ação do executor**                                            | **Resultado esperado**                                                            |
|--------|-----------------------------------------------------------------|-----------------------------------------------------------------------------------|
| **1**  | Preencher “E-mail” com o endereço informado nos dados de teste. | O e-mail aparece completo no campo.                                               |
| **2**  | Preencher “Sugestão” com o texto informado.                     | O texto aparece no campo e o contador corresponde à quantidade digitada.          |
| **3**  | Clicar em “Enviar” uma única vez.                               | Durante o envio, o botão indica processamento e evita envio repetido.             |
| **4**  | Aguardar a conclusão.                                           | É exibida a mensagem “Sugestão enviada com sucesso!”. Os campos são limpos.       |
| **5**  | Observar o primeiro item de “Sugestões enviadas”.               | A nova sugestão aparece no topo, com o texto informado e status “Não respondido”. |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-03 - Impedir envio sem e-mail

| **Funcionalidade**    | Validação do formulário do aluno                                                   |
|-----------------------|------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Funcional negativo / campo obrigatório \| Alta                                     |
| **Objetivo**          | Verificar se o sistema impede o envio quando o e-mail obrigatório não é informado. |
| **Pré-condições**     | Aluno autenticado e na página “Caixa de Sugestões”.                                |
| **Dados de teste**    | E-mail: vazio \| Sugestão: Melhorar a sinalização dos setores da secretaria.       |

| **\#** | **Ação do executor**                       | **Resultado esperado**                                                                                    |
|--------|--------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| **1**  | Deixar o campo “E-mail” vazio.             | O campo permanece vazio.                                                                                  |
| **2**  | Preencher “Sugestão” com o texto de teste. | O texto é aceito e o contador é atualizado.                                                               |
| **3**  | Clicar em “Enviar”.                        | A sugestão não é cadastrada e o sistema solicita um e-mail para contato. Nenhum novo item surge na lista. |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-04 - Impedir envio com e-mail inválido

| **Funcionalidade**    | Validação do formulário do aluno                                                               |
|-----------------------|------------------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Funcional negativo / formato \| Alta                                                           |
| **Objetivo**          | Validar o tratamento de endereço de e-mail em formato inválido.                                |
| **Pré-condições**     | Aluno autenticado e na página “Caixa de Sugestões”.                                            |
| **Dados de teste**    | Executar com: maria.qa; maria@; @fatec.sp.gov.br \| Sugestão válida com 20 ou mais caracteres. |

| **\#** | **Ação do executor**                                       | **Resultado esperado**                                                      |
|--------|------------------------------------------------------------|-----------------------------------------------------------------------------|
| **1**  | Informar o primeiro e-mail inválido e uma sugestão válida. | Os valores permanecem visíveis para conferência.                            |
| **2**  | Clicar em “Enviar”.                                        | O navegador ou o sistema impede o envio e sinaliza que o e-mail é inválido. |
| **3**  | Repetir o teste com os demais e-mails inválidos.           | Nenhum dos formatos inválidos gera cadastro ou novo item na listagem.       |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-05 - Validar tamanho mínimo da sugestão

| **Funcionalidade**    | Validação do conteúdo da sugestão                                                                   |
|-----------------------|-----------------------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Valor-limite / negativo e positivo \| Alta                                                          |
| **Objetivo**          | Confirmar que o conteúdo precisa ter pelo menos 3 caracteres após remover espaços nas extremidades. |
| **Pré-condições**     | Aluno autenticado e na página “Caixa de Sugestões”.                                                 |
| **Dados de teste**    | E-mail válido \| Partições: “ ” (só espaços), “Oi” (2 caracteres), “Olá” (3 caracteres).            |

| **\#** | **Ação do executor**                                     | **Resultado esperado**                                                 |
|--------|----------------------------------------------------------|------------------------------------------------------------------------|
| **1**  | Tentar enviar usando apenas espaços no campo “Sugestão”. | O cadastro é impedido e é exibida orientação para escrever a sugestão. |
| **2**  | Tentar enviar o conteúdo “Oi”.                           | O cadastro é impedido por possuir menos de 3 caracteres.               |
| **3**  | Tentar enviar o conteúdo “Olá”.                          | O valor-limite de 3 caracteres é aceito e a sugestão é cadastrada.     |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-06 - Validar tamanho máximo da sugestão

| **Funcionalidade**    | Validação do conteúdo da sugestão                                                                 |
|-----------------------|---------------------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Valor-limite \| Alta                                                                              |
| **Objetivo**          | Verificar o limite de 1.000 caracteres definido para a sugestão.                                  |
| **Pré-condições**     | Aluno autenticado e na página “Caixa de Sugestões”; texto de teste previamente contado.           |
| **Dados de teste**    | E-mail válido \| Texto A: exatamente 1.000 caracteres \| tentativa de inserir o 1.001º caractere. |

| **\#** | **Ação do executor**                       | **Resultado esperado**                                               |
|--------|--------------------------------------------|----------------------------------------------------------------------|
| **1**  | Colar o Texto A no campo “Sugestão”.       | O campo exibe o texto completo e o contador mostra 1000/1000.        |
| **2**  | Tentar digitar ou colar mais um caractere. | O campo não ultrapassa 1.000 caracteres.                             |
| **3**  | Clicar em “Enviar”.                        | A sugestão com exatamente 1.000 caracteres é cadastrada com sucesso. |
| **4**  | Abrir a sugestão criada.                   | Todo o conteúdo permanece armazenado e legível, sem corte indevido.  |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-07 - Preservar acentos, caracteres especiais e quebras de linha

| Campo | Descrição |
|---|---|
| **Funcionalidade** | Integridade de entrada e exibição |
| **Tipo / prioridade** | Cobertura de inputs / Média |
| **Objetivo** | Validar a entrada e a exibição segura de conteúdo representativo do português brasileiro. |
| **Pré-condições** | Aluno autenticado e na página “Caixa de Sugestões”. |

**Dados de teste:**

- E-mail: `qa+nf2@fatec.sp.gov.br`
- Conteúdo: `Sugestão: melhorar o atendimento!`
- Segunda linha: `Horário: 18h-21h.`
- Terceira linha: `Setor: Secretaria (1º andar).`

| **\#** | **Ação do executor**                                                     | **Resultado esperado**                                                        |
|--------|--------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| **1**  | Preencher os campos com os dados de teste, mantendo as quebras de linha. | Acentos, pontuação, símbolo “+” do e-mail e quebras de linha são aceitos.     |
| **2**  | Enviar a sugestão e abrir o item recém-criado.                           | O conteúdo é exibido sem símbolos corrompidos e preserva as quebras de linha. |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-08 - Consultar detalhe de sugestão não respondida

| **Funcionalidade**    | Detalhe da sugestão do aluno                                               |
|-----------------------|----------------------------------------------------------------------------|
| **Tipo / prioridade** | Funcional positivo \| Alta                                                 |
| **Objetivo**          | Validar a consulta de uma sugestão própria que ainda não recebeu resposta. |
| **Pré-condições**     | Aluno autenticado; existir sugestão própria com status “Não respondido”.   |
| **Dados de teste**    | Usar a sugestão criada no CT-NF2-02 antes da resposta administrativa.      |

| **\#** | **Ação do executor**                                      | **Resultado esperado**                                                                        |
|--------|-----------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| **1**  | Na lista, clicar na sugestão com status “Não respondido”. | A página de detalhe é aberta.                                                                 |
| **2**  | Conferir o conteúdo e o status.                           | O texto corresponde ao cadastrado e o selo mostra “Não respondido”. Não há bloco de resposta. |
| **3**  | Clicar em “Voltar para Caixa de Sugestões”.               | O sistema retorna à listagem do aluno.                                                        |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-09 - Restringir acesso do aluno à sugestão de outro usuário

| **Funcionalidade**    | Autorização e privacidade                                                                                |
|-----------------------|----------------------------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Permissão / negativo \| Crítica                                                                          |
| **Objetivo**          | Garantir que um aluno não visualize dados, e-mail ou resposta pertencentes a outro aluno.                |
| **Pré-condições**     | Dois alunos autenticáveis; sugestão criada pelo ALUNO_QA_02; possuir o identificador/URL desse registro. |
| **Dados de teste**    | Sessão atual: ALUNO_QA_01 \| URL da sugestão do ALUNO_QA_02: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_        |

| **\#** | **Ação do executor**                                                         | **Resultado esperado**                                                                                      |
|--------|------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| **1**  | Autenticar como ALUNO_QA_01.                                                 | A sessão corresponde ao primeiro aluno.                                                                     |
| **2**  | Acessar diretamente a URL de detalhe da sugestão pertencente ao ALUNO_QA_02. | O sistema exibe “Sugestão não encontrada.” ou bloqueia o acesso, sem revelar conteúdo, e-mail, nome ou R.A. |
| **3**  | Retornar à lista do ALUNO_QA_01.                                             | A sugestão do segundo aluno não aparece na lista.                                                           |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-10 - Paginar sugestões do aluno

| **Funcionalidade**    | Listagem e paginação do aluno                                                 |
|-----------------------|-------------------------------------------------------------------------------|
| **Tipo / prioridade** | Fluxo alternativo \| Média                                                    |
| **Objetivo**          | Validar a ordenação e a navegação quando o aluno possui mais de 10 sugestões. |
| **Pré-condições**     | Aluno autenticado com pelo menos 11 sugestões próprias.                       |
| **Dados de teste**    | Massa preparada: 11 sugestões identificadas de QA-01 a QA-11.                 |

| **\#** | **Ação do executor**                          | **Resultado esperado**                                                                 |
|--------|-----------------------------------------------|----------------------------------------------------------------------------------------|
| **1**  | Abrir “Caixa de Sugestões”.                   | A primeira página mostra no máximo 10 registros, do mais recente para o mais antigo.   |
| **2**  | Clicar na página 2 ou na seta para a direita. | A página 2 é exibida com os registros restantes; o controle de voltar fica habilitado. |
| **3**  | Voltar à página 1.                            | A primeira página é restaurada sem duplicar ou perder registros.                       |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-11 - Listar sugestões no perfil administrativo

| **Funcionalidade**    | Caixa de Sugestões administrativa                                                                      |
|-----------------------|--------------------------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Funcional positivo / permissão \| Crítica                                                              |
| **Objetivo**          | Confirmar que o perfil autorizado visualiza sugestões de diferentes alunos com identificação e status. |
| **Pré-condições**     | Usuário com perfil ADMINISTRADOR, BACKOFFICE ou TECNICO; sugestões de ao menos dois alunos.            |
| **Dados de teste**    | Funcionário: STAFF_QA_01 \| Registros: um não respondido e um respondido.                              |

| **\#** | **Ação do executor**                                           | **Resultado esperado**                                                                              |
|--------|----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| **1**  | Autenticar com perfil autorizado e abrir “Caixa de Sugestões”. | A página administrativa é exibida com o texto “Sugestões enviadas pelos alunos”.                    |
| **2**  | Conferir os itens listados.                                    | Os registros de diferentes alunos são exibidos com nome, R.A., trecho do conteúdo e selo de status. |
| **3**  | Conferir a ordem.                                              | Os itens estão ordenados do mais recente para o mais antigo.                                        |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-12 - Filtrar sugestões por status

| **Funcionalidade**    | Filtro da listagem administrativa                                              |
|-----------------------|--------------------------------------------------------------------------------|
| **Tipo / prioridade** | Caminhos / filtros \| Alta                                                     |
| **Objetivo**          | Validar as opções “Todos os status”, “Não respondido” e “Respondido”.          |
| **Pré-condições**     | Staff autenticado; base com sugestões nos dois status.                         |
| **Dados de teste**    | Filtro A: Não respondido \| Filtro B: Respondido \| Filtro C: Todos os status. |

| **\#** | **Ação do executor**                                          | **Resultado esperado**                                                                                     |
|--------|---------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| **1**  | Selecionar “Não respondido”.                                  | A listagem é recarregada e mostra somente itens com selo “Não respondido”; a paginação retorna à página 1. |
| **2**  | Selecionar “Respondido”.                                      | A listagem mostra somente itens com selo “Respondido”.                                                     |
| **3**  | Selecionar “Todos os status”.                                 | A listagem volta a apresentar registros dos dois status.                                                   |
| **4**  | Aplicar um filtro sem resultados, caso exista massa adequada. | É exibida a mensagem “Nenhuma sugestão encontrada.”, sem erro de interface.                                |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-13 - Abrir detalhe administrativo

| **Funcionalidade**    | Detalhe da sugestão administrativa                                         |
|-----------------------|----------------------------------------------------------------------------|
| **Tipo / prioridade** | Funcional positivo \| Alta                                                 |
| **Objetivo**          | Validar os dados apresentados ao funcionário/professor antes de responder. |
| **Pré-condições**     | Staff autenticado; sugestão não respondida existente.                      |
| **Dados de teste**    | Selecionar sugestão do CT-NF2-02.                                          |

| **\#** | **Ação do executor**                            | **Resultado esperado**                                                                            |
|--------|-------------------------------------------------|---------------------------------------------------------------------------------------------------|
| **1**  | Na listagem administrativa, clicar na sugestão. | A página de detalhe é aberta.                                                                     |
| **2**  | Conferir cabeçalho e conteúdo.                  | São exibidos nome do aluno, R.A., e-mail de contato, conteúdo completo e status “Não respondido”. |
| **3**  | Conferir os controles.                          | O campo de resposta, o seletor de status e o botão “Salvar” estão habilitados.                    |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-14 - Salvar resposta mantendo status “Não respondido”

| **Funcionalidade**    | Resposta administrativa e imutabilidade                                                                                   |
|-----------------------|---------------------------------------------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Regra de negócio / caminho alternativo \| Crítica                                                                         |
| **Objetivo**          | Verificar que uma resposta pode ser salva antes da finalização e que seu texto fica bloqueado após o primeiro salvamento. |
| **Pré-condições**     | Staff autenticado; sugestão ainda sem resposta e com status “Não respondido”.                                             |
| **Dados de teste**    | Resposta: “Recebemos sua sugestão e ela será avaliada pela equipe responsável.” \| Status: Não respondido.                |

| **\#** | **Ação do executor**                                          | **Resultado esperado**                                                                                    |
|--------|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| **1**  | Abrir a sugestão e preencher a resposta com o texto de teste. | O contador é atualizado e o texto permanece editável antes de salvar.                                     |
| **2**  | Manter o status “Não respondido” e clicar em “Salvar”.        | É exibida a mensagem “Sugestão atualizada!”. O status permanece “Não respondido”.                         |
| **3**  | Após o recarregamento, tentar editar a resposta.              | O campo de resposta está desabilitado e aparece “Esta resposta já foi salva e não pode mais ser editada.” |
| **4**  | Conferir o seletor de status.                                 | O status ainda pode ser alterado para “Respondido”.                                                       |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-15 - Finalizar sugestão como respondida

| **Funcionalidade**    | Resposta administrativa e status definitivo                                       |
|-----------------------|-----------------------------------------------------------------------------------|
| **Tipo / prioridade** | Regra de negócio / ponta a ponta \| Crítica                                       |
| **Objetivo**          | Validar a mudança definitiva para “Respondido” e a exibição da resposta ao aluno. |
| **Pré-condições**     | Sugestão com resposta salva e status “Não respondido” (resultado do CT-NF2-14).   |
| **Dados de teste**    | Alterar somente o status para “Respondido”.                                       |

| **\#** | **Ação do executor**                                                     | **Resultado esperado**                                                                                                    |
|--------|--------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| **1**  | No detalhe administrativo, selecionar “Respondido” e clicar em “Salvar”. | O sistema confirma a atualização e o selo muda para “Respondido”.                                                         |
| **2**  | Conferir a área administrativa após recarregar.                          | Resposta e status ficam desabilitados; o botão “Salvar” deixa de ser exibido; aparece aviso de que o status é definitivo. |
| **3**  | Autenticar como o aluno proprietário e abrir a mesma sugestão.           | O selo mostra “Respondido” e é exibido o bloco com a resposta e o nome do responsável, quando disponível.                 |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-16 - Impedir alteração após status “Respondido”

| **Funcionalidade**    | Imutabilidade da resposta                                                    |
|-----------------------|------------------------------------------------------------------------------|
| **Tipo / prioridade** | Regra de negócio / negativo \| Crítica                                       |
| **Objetivo**          | Garantir que uma sugestão finalizada não tenha resposta ou status alterados. |
| **Pré-condições**     | Sugestão com status “Respondido”; staff autenticado.                         |
| **Dados de teste**    | Sugestão finalizada no CT-NF2-15.                                            |

| **\#** | **Ação do executor**                                 | **Resultado esperado**                                                                                |
|--------|------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| **1**  | Abrir o detalhe da sugestão respondida.              | O campo de resposta e o seletor de status estão desabilitados.                                        |
| **2**  | Observar as ações disponíveis.                       | O botão “Salvar” não é exibido e os avisos informam que resposta/status não podem mais ser alterados. |
| **3**  | Reabrir a página ou acessar novamente pela listagem. | O bloqueio permanece e os dados continuam iguais aos salvos.                                          |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-17 - Validar limite da resposta administrativa

| **Funcionalidade**    | Validação da resposta                                                                                              |
|-----------------------|--------------------------------------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Valor-limite / compatibilidade entre camadas \| Alta                                                               |
| **Objetivo**          | Confirmar o comportamento do limite exibido pela tela e evidenciar a divergência entre frontend e backend.         |
| **Pré-condições**     | Staff autenticado; sugestão nova, sem resposta; textos previamente contados.                                       |
| **Dados de teste**    | Texto A: exatamente 500 caracteres \| tentativa de inserir o 501º \| referência técnica: backend aceita até 1.000. |

| **\#** | **Ação do executor**                                   | **Resultado esperado**                                                                          |
|--------|--------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| **1**  | Colar o Texto A no campo de resposta.                  | O contador mostra 500/500 e o texto completo permanece no campo.                                |
| **2**  | Tentar inserir o 501º caractere.                       | A interface não permite ultrapassar 500 caracteres.                                             |
| **3**  | Salvar a resposta com exatamente 500 caracteres.       | A resposta é salva com sucesso e sem truncamento.                                               |
| **4**  | Registrar em evidência o limite mostrado na interface. | A evidência permite comparar o limite de 500 da tela com o limite de 1.000 definido no backend. |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

## CT-NF2-18 - Impedir aluno de responder sugestão

| **Funcionalidade**    | Autorização de resposta                                                              |
|-----------------------|--------------------------------------------------------------------------------------|
| **Tipo / prioridade** | Permissão / negativo \| Crítica                                                      |
| **Objetivo**          | Garantir que apenas ADMINISTRADOR, BACKOFFICE ou TECNICO respondam/alterem o status. |
| **Pré-condições**     | Aluno autenticado; sugestão própria existente.                                       |
| **Dados de teste**    | Usuário: ALUNO_QA_01.                                                                |

| **\#** | **Ação do executor**                                                         | **Resultado esperado**                                                                                                          |
|--------|------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| **1**  | Abrir o detalhe de uma sugestão própria como aluno.                          | A página apresenta somente conteúdo, status e eventual resposta; não há campo de resposta, seletor de status ou botão “Salvar”. |
| **2**  | Verificar toda a página e ações disponíveis.                                 | Nenhum controle administrativo fica exposto ao aluno.                                                                           |
| **3**  | Se o roteiro técnico permitir, tentar enviar PATCH usando a sessão do aluno. | A operação é recusada por falta de permissão e os dados permanecem inalterados.                                                 |

**Resultado obtido:**  
________________________________________________________________________________  
________________________________________________________________________________

**Status:**

- [ ] Passou
- [ ] Falhou
- [ ] Bloqueado
- [ ] Não executado

**Evidência:** vídeo, print ou link: ________________________________________________

**Observações:**  
________________________________________________________________________________

# 9. Registro de defeitos

Preencher uma linha para cada comportamento divergente. Relacionar o defeito ao vídeo ou print correspondente.

| **Defeito** | **Caso** | **Resumo** | **Severidade** | **Status** | **Evidência** |
|-------------|----------|------------|----------------|------------|---------------|
|             |          |            |                |            |               |
|             |          |            |                |            |               |
|             |          |            |                |            |               |
|             |          |            |                |            |               |
|             |          |            |                |            |               |
|             |          |            |                |            |               |
|             |          |            |                |            |               |
|             |          |            |                |            |               |

# 10. Ponto de atenção identificado antes da execução

**Divergência de limite da resposta:** a tela administrativa limita a resposta a 500 caracteres, enquanto a validação do backend permite até 1.000. O CT-NF2-17 deve produzir evidência para que a equipe decida qual limite é o requisito correto e alinhe as duas camadas.

# 11. Encerramento

| **Total executado** | \_\_\_\_\_\_ de 18 casos                                                                                                     |
|---------------------|------------------------------------------------------------------------------------------------------------------------------|
| **Passou**          | \_\_\_\_\_\_                                                                                                                 |
| **Falhou**          | \_\_\_\_\_\_                                                                                                                 |
| **Bloqueado**       | \_\_\_\_\_\_                                                                                                                 |
| **Conclusão**       | \[ \] Aprovado para entrega \[ \] Aprovado com ressalvas \[ \] Reprovado                                                     |
| **Responsável QA**  | Nome: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Assinatura/Data: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
