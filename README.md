# Detalhamento BR — Add-in para Revit

Add-in nativo em C#/.NET (Revit API) para automatizar tarefas de detalhamento de projetos.

## Funcionalidades

| Comando | O que faz |
|---|---|
| **Selecionar Paredes** | Seleciona todas as paredes visíveis na vista ativa — útil como passo prévio a "Criar Vistas de Detalhe". |
| **Criar Vistas de Detalhe** | Gera vistas de detalhe (callouts) automaticamente a partir da caixa delimitadora de elementos ou grupos selecionados na vista ativa. |
| **Criar Pranchas** | Cria uma prancha (com o carimbo escolhido) e posiciona as vistas selecionadas em um layout de grade configurável (nº de colunas). |
| **Anotação Automática** | Aplica tags por categoria (paredes, portas, janelas, pisos, ambientes) em elementos ainda não anotados na vista ativa, e permite criar uma linha de cotas cruzando faces de paredes. |
| **Exportar Parâmetros** | Extrai parâmetros de elementos filtrados por categoria (e opcionalmente só da vista ativa) e exporta para CSV. |

## Estrutura do projeto

```
RevitDetailingTool.sln
src/RevitDetailingTool/
├── App.cs                          # IExternalApplication — cria a aba/ribbon "Detalhamento BR"
├── RevitDetailingTool.addin        # Manifesto do add-in
├── Commands/                       # IExternalCommand — um por botão do ribbon
│   ├── SelectWallsCommand.cs
│   ├── CreateDetailViewsCommand.cs
│   ├── AutoPlaceSheetsCommand.cs
│   ├── AutoAnnotateCommand.cs
│   └── ExportParametersCommand.cs
├── Services/                       # Lógica de negócio (chamadas à Revit API)
│   ├── DetailViewService.cs
│   ├── SheetService.cs
│   ├── AnnotationService.cs
│   └── ParameterExtractionService.cs
└── UI/                             # Janelas WPF de configuração de cada comando
    ├── SheetsWindow.xaml(.cs)
    ├── AnnotationWindow.xaml(.cs)
    └── ParameterExportWindow.xaml(.cs)
```

## Pré-requisitos

- **Windows** com **Autodesk Revit** instalado (2022–2024 por padrão neste projeto).
- **Visual Studio 2022** (workload ".NET desktop development").
- .NET Framework 4.8 Developer Pack (para o alvo `net48`).

As referências à Revit API (`RevitAPI.dll` / `RevitAPIUI.dll`) vêm via NuGet
(`Nice3point.Revit.Api.RevitAPI` / `...RevitAPIUI`), então **não é necessário**
configurar caminhos manuais para a instalação do Revit — o pacote já traz os
binários corretos da versão escolhida.

## Build

Abra `RevitDetailingTool.sln` no Visual Studio e compile (Debug|x64 ou Release|x64).
O `.csproj` já copia `RevitDetailingTool.addin` para a pasta de saída junto com o `.dll`.

### Trocar a versão do Revit alvo

Por padrão o projeto mira **Revit 2022–2024** (`net48`). Para Revit 2025+:

1. Em `src/RevitDetailingTool/RevitDetailingTool.csproj`, troque:
   - `<TargetFramework>net48</TargetFramework>` → `<TargetFramework>net8.0-windows</TargetFramework>`
   - As versões dos pacotes `Nice3point.Revit.Api.RevitAPI(UI)` para `2025.*`.

## Instalação (carregar no Revit)

Copie o `.dll` compilado e o `RevitDetailingTool.addin` para:

```
%APPDATA%\Autodesk\Revit\Addins\<ano>\
```

(ex.: `%APPDATA%\Autodesk\Revit\Addins\2024\`). Ajuste o caminho do `<Assembly>`
no `.addin` se os arquivos não ficarem na mesma pasta.

## Observações importantes

- Este projeto foi montado em um ambiente Linux sem Revit/Visual Studio instalados,
  então o código **não pôde ser compilado nem testado aqui**. A implementação segue
  os padrões idiomáticos da Revit API (Transactions, `IExternalCommand`, coletores
  filtrados, etc.), mas **revise no Visual Studio** (com IntelliSense contra a versão
  exata da API) antes de usar em produção — em especial `AnnotationService` (geometria
  de faces/interseção), que é a parte mais sensível a variações entre versões da API.
- "Criar Vistas de Detalhe" usa a seleção atual (elementos ou Grupos) para definir a
  região do callout — não há detecção automática de "detalhes típicos" sem uma
  biblioteca de referência; isso pode ser adicionado depois se fizer sentido.
- Os ícones dos botões do ribbon não foram incluídos (nenhum `LargeImage`/`Image`
  configurado em `PushButtonData`); adicione arquivos `.png` e defina via
  `BitmapImage` em `App.cs` quando quiser.

## Próximos passos sugeridos

- Adicionar ícones ao ribbon.
- Suporte a criação de múltiplas pranchas em lote (hoje é uma prancha por execução).
- Persistir configurações do usuário (última categoria, colunas, etc.).
- Testes automatizados via Revit Test Framework (RTF) ou similar.
