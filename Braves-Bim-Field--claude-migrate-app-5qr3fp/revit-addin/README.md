# Braves BIM Field — Importador para Revit

Add-in para Revit 2024 que lê o arquivo `levantamento_bim.json` exportado
pelo app (aba **Sincronização → JSON**) e cria no Revit, no projeto aberto:

- **Níveis** (reaproveitando um nível existente com nome ou cota parecida; cria os que faltarem)
- **Paredes** (tenta casar o tipo do levantamento — ex: "Alvenaria 15cm" — com um
  tipo de parede do seu projeto com o **mesmo nome exato**; se não achar, usa o
  tipo padrão do projeto; se marcada como "Demolir" ou "À construir" no app,
  vira Fase de Demolição/Fase Criada no Revit — veja
  [Reforma: Demolir/À construir](#reforma-demolirà-construir-vira-fases-do-revit))
- **Portas e janelas** (usa a primeira família de porta/janela carregada no
  projeto; ajusta largura/altura se a família tiver esses parâmetros; mesma
  marcação de Demolir/À construir das paredes)
- **Ambientes** (cria um `Room` no centro de cada contorno fechado desenhado
  no Croqui — precisa que as paredes já formem um contorno fechado — e grava
  o piso/forro escolhido no app nos parâmetros nativos "Acabamento do Piso"/
  "Acabamento do Forro" do `Room`)
- **Luminárias** (usa a primeira família de luminária carregada no projeto,
  posicionada na altura do forro de cada nível)
- **Escadas** (cria uma `Stairs` de lance reto entre o nível de origem e o
  nível de destino escolhidos no Croqui)
- **Coberturas** (cria um `FootPrintRoof` — veja a limitação importante
  abaixo, o app ainda não desenha o contorno real do telhado)

### Limitações desta primeira versão de escadas e coberturas

Estas duas são bem mais aproximadas que o resto do import, porque o Croqui
ainda não guarda geometria detalhada o suficiente para modelá-las de verdade:

- **Escadas**: o app só guarda uma linha reta (início/fim) e, se houver
  patamar, sua posição e altura ao longo do trajeto — não a direção do giro.
  O add-in cria um lance reto simples entre os dois níveis; se a escada
  levantada tem patamar, os dados reais (posição/altura) ficam gravados em
  "Comentários" mas **não são modelados** — ajuste manualmente no Revit.
  Diferente de paredes/portas/ambientes, uma escada já importada antes é
  sempre **apagada e recriada do zero** a cada nova importação (editar a
  geometria de uma escada existente via API é bem mais arriscado sem poder
  testar contra um Revit de verdade) — qualquer ajuste manual feito nela
  direto no Revit se perde numa reimportação.
- **Coberturas**: o app guarda só um nome, o nível, e a inclinação/área de
  cada "água" como texto — nenhum contorno/formato real. O add-in aproxima
  o contorno pelo **retângulo que envolve todas as paredes do nível**
  (não o formato real do telhado) e aplica a inclinação da primeira água a
  todas as bordas; os dados completos de todas as águas ficam em
  "Comentários" para conferência. Também é sempre apagada e recriada a cada
  importação.

Se essas simplificações não servem pro seu caso, o jeito mais confiável por
enquanto é ajustar a escada/cobertura manualmente no Revit depois de importar
— ou não usar o import automático para elas e modelar do zero.

### Reforma: Demolir/À construir vira Fases do Revit

No Croqui do app, uma parede/porta/janela pode ser marcada como **Demolir**
(vermelho tracejado) ou **À construir** (verde tracejado) — pense numa
reforma, onde é preciso distinguir o que existe e sai do que é novo. O add-in
lê essa marcação e usa o mecanismo nativo de **Fases** do Revit (Gerenciar →
Fases) para reproduzi-la:

- **Demolir** → a **Fase de Criação** do elemento vira a fase mais antiga do
  projeto, e sua **Fase de Demolição** vira a fase mais recente — o Revit
  passa a mostrá-lo demolido (tracejado/esmaecido, conforme os filtros de
  fase da sua vista) a partir dali.
- **À construir** → a **Fase de Criação** vira a fase mais recente do
  projeto — o Revit passa a tratá-lo como obra nova.

Isso usa exatamente os mesmos parâmetros que você ajustaria manualmente na
paleta de Propriedades — então filtros de fase, "Mostrar Anterior + Demolição"/
"Mostrar Novo" e as substituições gráficas de cada fase (tracejado/esmaecido
para demolido, etc.) funcionam sem nenhum ajuste extra de template de vista.

**Pré-requisito**: seu projeto Revit precisa ter **pelo menos 2 fases**
cadastradas (Gerenciar → Fases) — a maioria dos templates de arquitetura já
vem com duas (ex: "Existente" e "Construção Nova"), e é a mais antiga e a
mais recente da sua lista que o add-in usa, seja qual for o nome delas. Se o
projeto só tiver uma fase, essas marcações são ignoradas (nada quebra, só não
tem "antes/depois" pra aplicar) e o resumo final avisa: "O projeto precisa de
pelo menos 2 fases... nenhuma foi aplicada".

### Piso/forro do ambiente não vira um Floor/Ceiling de verdade

O acabamento de piso/forro escolhido no Croqui é gravado nos parâmetros de
texto do `Room` ("Acabamento do Piso"/"Acabamento do Forro"), não como um
elemento `Floor`/`Ceiling` real com um `Material` do Revit associado — o app
guarda esses acabamentos como um nome de uma lista fixa (ex: "Porcelanato"),
não como referência a um material real do seu projeto, então não há como
casar automaticamente um `Material` sem arriscar pegar o errado.

### Importar de novo não duplica

Rodar qualquer um dos dois comandos de novo no mesmo projeto Revit
**atualiza** as paredes/portas/janelas/ambientes/luminárias já importados
(posição, tipo, dimensões) em vez de criar um segundo conjunto por cima do
primeiro — o add-in reconhece cada elemento por um identificador oculto
gravado no campo Comentários dele. Elementos **novos** no levantamento (ex:
uma porta que você acabou de adicionar no app) são criados normalmente.
Escadas e coberturas são a exceção — veja a seção
[Limitações desta primeira versão](#limitações-desta-primeira-versão-de-escadas-e-coberturas)
acima, elas são sempre apagadas e recriadas do zero a cada importação.

Importante: se você **apagar** algo no app (uma parede, porta, etc.) e
importar de novo, o elemento correspondente **não é apagado automaticamente**
do Revit — isso é proposital, pra nunca descartar sem avisar algo que você
possa ter ajustado manualmente lá. Nesse caso, apague-o você mesmo no Revit
(pode identificar pelo texto em Comentários).

## ⚠️ Aviso importante

Este código foi escrito consultando a documentação da API do Revit, mas
**nunca foi compilado nem testado contra uma instalação real do Revit** —
o ambiente onde ele foi criado não tem Windows nem Revit instalados. É bem
provável que a primeira tentativa de build dê algum erro de compilação ou
que algo precise de ajuste ao rodar de verdade. Isso é esperado — me manda
a mensagem de erro (do Visual Studio ou do Revit) que eu corrijo.

A parte de **escadas** (`StairsEditScope`/`StairsRun`) e **coberturas**
(`FootPrintRoof`) usa partes da API do Revit bem mais intrincadas que o
resto do add-in (paredes/portas/janelas/ambientes já vinham de antes e
foram usadas com mais confiança) — é onde um erro de compilação ou de
execução é mais provável de aparecer primeiro. Se o import falhar só
nessas duas partes, os avisos "⚠ N escada(s)/cobertura(s) ignorada(s)" no
resumo final ajudam a isolar qual delas.

## Pré-requisitos

- Windows com **Revit 2024** instalado
- **Visual Studio 2022** (a versão Community, gratuita, serve) com a carga
  de trabalho **".NET desktop development"** marcada na instalação
- Conexão com a internet na primeira compilação (para baixar o pacote
  Newtonsoft.Json via NuGet)

## Como compilar

1. Abra `BravesBimFieldImporter.sln` no Visual Studio.
2. Se o seu Revit 2024 **não** estiver instalado em
   `C:\Program Files\Autodesk\Revit 2024`, edite essa pasta no arquivo
   `BravesBimFieldImporter\BravesBimFieldImporter.csproj` (propriedade
   `RevitInstallDir`).
3. Selecione a configuração **Release** e plataforma **x64** (barra de
   ferramentas do Visual Studio).
4. Menu **Compilar → Compilar Solução** (ou `Ctrl+Shift+B`).
5. O arquivo `BravesBimFieldImporter.dll` vai aparecer em
   `BravesBimFieldImporter\bin\x64\Release\net48\`.

## Como instalar no Revit

1. Localize a pasta de add-ins do Revit 2024 (crie se não existir):
   `%APPDATA%\Autodesk\Revit\Addins\2024\`
   (cole esse caminho no Explorer de arquivos — `%APPDATA%` já expande sozinho.
   Repare que é `Addins\2024\` — não crie uma subpasta `Addins` **dentro**
   de `2024`, os arquivos ficam soltos direto ali.)
2. Copie para essa pasta, da pasta `BravesBimFieldImporter\bin\x64\Release\net48\`:
   - `BravesBimFieldImporter.dll`
   - `Newtonsoft.Json.dll` (dependência — o Revit precisa dela junto)
   - `firebase.config.json.example`
   
   E da raiz de `revit-addin/`:
   - `BravesBimFieldImporter.addin`
3. **Se os arquivos vieram de um ZIP baixado da internet**, clique com o
   botão direito em `BravesBimFieldImporter.dll` e `Newtonsoft.Json.dll` →
   **Propriedades** → marque **"Desbloquear"** (se aparecer essa opção) → OK.
   O Windows marca arquivos baixados como "bloqueados" e o Revit ignora
   add-ins bloqueados sem avisar nada.
4. Renomeie `firebase.config.json.example` para `firebase.config.json` e
   edite ele com as mesmas credenciais do `.env` do app (veja
   [Configurar a importação pela nuvem](#configurar-a-importação-pela-nuvem)
   abaixo) — só precisa disso se for usar o comando "Importar da nuvem".
5. Abra (ou reabra) o Revit.
6. Deve aparecer uma aba própria **"Braves BIM Field"** na faixa de opções
   (ribbon), com dois botões grandes:
   - **Braves Cloud** — importa direto da nuvem (mesmo comando "Importar da
     nuvem" abaixo)
   - **Braves Import** — importa de um arquivo `levantamento_bim.json`

   Os mesmos dois comandos também continuam disponíveis em
   **Complementos → Ferramentas Externas**, caso a aba não apareça por algum
   motivo (ex: versão do Revit mais restrita quanto a plugins de interface).

## Importar da nuvem (recomendado — sem precisar de arquivo)

Com o Firebase já configurado no app (veja o README principal do repositório),
o levantamento sincroniza sozinho pra nuvem a cada alteração. O comando
**"Importar da nuvem"**:

1. Pede as credenciais do seu Firebase (arquivo `firebase.config.json` — passo
   4 acima)
2. Mostra uma janela com todos os projetos já sincronizados, com uma caixa de
   busca por nome
3. Digite parte do nome do projeto, escolha na lista (ou dê duplo clique) e
   clique em **Abrir**
4. Importa direto — sem precisar exportar/transferir nenhum arquivo

### Configurar a importação pela nuvem

Abra o arquivo `.env` que você criou pra configurar o Firebase do app (na
raiz do repositório principal) e copie dois valores pro
`firebase.config.json` do add-in:

```json
{
  "apiKey": "valor de VITE_FIREBASE_API_KEY no seu .env",
  "projectId": "valor de VITE_FIREBASE_PROJECT_ID no seu .env"
}
```

Esse arquivo precisa estar na **mesma pasta** do `BravesBimFieldImporter.dll`
(dentro de `Addins\2024\`).

## Importar de arquivo (alternativa, sem Firebase)

1. No app (celular/tablet), faça o levantamento normalmente.
2. Na aba **Sincronização**, clique em **JSON** para baixar `levantamento_bim.json`.
3. Transfira esse arquivo pro computador com Revit (e-mail, nuvem, cabo USB — como preferir).
4. Abra o projeto Revit onde quer importar (de preferência um projeto que já
   tenha os níveis certos, já que você escolheu reaproveitar níveis existentes).
5. Rode o comando **"Importar de arquivo"** e selecione o arquivo.

## Personalizando o casamento de tipos

Hoje o add-in casa tipo de parede pelo **nome exato** (comparação sem diferenciar
maiúsculas/minúsculas) entre o `tipo` do JSON (ex: `"Alvenaria 15cm"`) e os
`WallType` já existentes no seu projeto/template Revit. Se os nomes não
baterem, ele usa o tipo padrão do projeto. Para ter tipos de parede corretos
automaticamente, crie no seu template Revit tipos de parede com esses nomes
exatos (a lista completa usada pelo app está em `WALL_TYPES` no arquivo
`src/App.jsx` do repositório principal).

### Portas e janelas — tipo (correr, pivotante...) e número de folhas

O add-in **não modela a geometria da porta/janela** — ele só escolhe, entre as
famílias de porta/janela **já carregadas no seu projeto Revit**, a que parecer
mais parecida com o que foi levantado no app, comparando o nome da família/tipo
com o campo `tipo` (ex: `"Correr — alumínio"`) e o número de `folhas` (ex: `4`).
Se o seu projeto só tiver uma porta genérica de 1 folha carregada, é essa que
vai ser usada mesmo que o levantamento diga "4 folhas" — o Revit não sabe criar
uma família de 4 folhas do nada.

Para o casamento funcionar (e a porta/janela sair com o número de folhas certo):

1. Carregue no projeto Revit as famílias de porta/janela que você realmente
   usa (inclusive as de correr com múltiplas folhas — o próprio Revit tem
   famílias como `Porta de Correr - 4 Folhas` na biblioteca padrão).
2. Nomeie os **tipos** dessas famílias de um jeito que inclua a palavra-chave
   do estilo (ex: "correr", "pivotante", "sanfonada", "basculante") e, quando
   for o caso, a palavra "folhas" junto do número (ex: `"Correr 4 folhas"`).
3. O add-in escolhe o tipo carregado com mais palavras em comum com o `tipo`
   do levantamento (ignorando acentos/maiúsculas) — quanto mais parecido o
   nome, melhor o casamento.

Já a **largura e altura** de cada porta/janela são sempre ajustadas para bater
com o que foi medido no app (tentando os parâmetros `Height`/`Width` e também
`Altura`/`Largura`, seja como parâmetro de instância ou de tipo) — isso
funciona independente do casamento de família ter sido perfeito ou não.

Quando largura/altura só existem como parâmetro de **tipo** na família (comum
em famílias mais simples) e o projeto tem poucas famílias carregadas, duas
portas/janelas de tamanhos diferentes podem acabar casando com o **mesmo**
tipo — nesse caso o add-in cria automaticamente uma cópia desse tipo dedicada
a cada tamanho (ex: `Porta Simples - 80x210`), em vez de ajustar o tipo
compartilhado e sem querer redimensionar todas as outras portas que o usam
também. Reimportar reaproveita essas cópias em vez de criar novas a cada vez.

#### Nenhuma informação do levantamento é perdida

Mesmo quando nenhuma família carregada no projeto parece com o que foi
levantado (ex: você levantou uma porta de correr de 4 folhas mas só tem uma
porta genérica de 1 folha no Revit), o add-in **nunca descarta** o que foi
medido: o tipo real (`"Correr — alumínio"`), o número de folhas, as dimensões
e (nas janelas) o peitoril são sempre escritos no campo **Comentários** de
cada porta/janela importada, por exemplo:

> Levantamento: Correr — alumínio · 4 folha(s) · 1.60×2.10 m — família/tipo
> não encontrado no projeto, AJUSTAR MANUALMENTE.

Ao final da importação, a mensagem de resumo do Revit avisa quantas
portas/janelas caíram nesse caso. Pra revisar todas de uma vez, crie uma
**Tabela de quantidades** de Portas (ou Janelas) no Revit e adicione a coluna
"Comentários" — as que precisam de ajuste manual aparecem com o aviso.
