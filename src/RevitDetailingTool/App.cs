using System;
using System.Reflection;
using Autodesk.Revit.UI;

namespace RevitDetailingTool
{
    public class App : IExternalApplication
    {
        private const string TabName = "Detalhamento BR";
        private const string PanelName = "Ferramentas";

        public Result OnStartup(UIControlledApplication application)
        {
            try
            {
                application.CreateRibbonTab(TabName);
            }
            catch (Exception)
            {
                // A aba já existe (ex.: recarregamento do add-in).
            }

            RibbonPanel panel = application.CreateRibbonPanel(TabName, PanelName);
            string assemblyPath = Assembly.GetExecutingAssembly().Location;

            AddPushButton(panel, assemblyPath,
                "SelecionarParedes", "Selecionar\nParedes",
                typeof(Commands.SelectWallsCommand).FullName!,
                "Seleciona todas as paredes visíveis na vista ativa.");

            AddPushButton(panel, assemblyPath,
                "CriarVistas", "Criar\nVistas de\nDetalhe",
                typeof(Commands.CreateDetailViewsCommand).FullName!,
                "Gera vistas de detalhe (callouts) a partir da caixa delimitadora dos elementos ou grupos selecionados na vista ativa.");

            AddPushButton(panel, assemblyPath,
                "CriarPranchas", "Criar\nPranchas",
                typeof(Commands.AutoPlaceSheetsCommand).FullName!,
                "Cria uma prancha e distribui automaticamente as vistas selecionadas em um layout de grade.");

            panel.AddSeparator();

            AddPushButton(panel, assemblyPath,
                "AutoAnotar", "Anotação\nAutomática",
                typeof(Commands.AutoAnnotateCommand).FullName!,
                "Aplica tags automaticamente por categoria na vista ativa e permite criar uma linha de cotas.");

            AddPushButton(panel, assemblyPath,
                "ExportarParam", "Exportar\nParâmetros",
                typeof(Commands.ExportParametersCommand).FullName!,
                "Extrai parâmetros de elementos por categoria e exporta para CSV.");

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication application) => Result.Succeeded;

        private static void AddPushButton(RibbonPanel panel, string assemblyPath, string name, string text, string className, string tooltip)
        {
            var data = new PushButtonData(name, text, assemblyPath, className)
            {
                ToolTip = tooltip
            };
            panel.AddItem(data);
        }
    }
}
