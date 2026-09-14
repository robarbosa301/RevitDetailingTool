using System;
using System.IO;
using System.Reflection;
using System.Windows.Media.Imaging;
using Autodesk.Revit.UI;

namespace RevitDetailingTool
{
    public class App : IExternalApplication
    {
        private const string TabName = "Braves BIM Field";
        private const string PanelName = "Ferramentas de Detalhamento";

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

            panel.AddSeparator();

            AddPushButton(panel, assemblyPath,
                "AbrirClaudeCode", "Abrir\nClaude Code",
                typeof(Commands.OpenClaudeCodeCommand).FullName!,
                "Abre uma janela do PowerShell em D:\\ROG\\BBF e inicia o Claude Code.");

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication application) => Result.Succeeded;

        private static void AddPushButton(RibbonPanel panel, string assemblyPath, string name, string text, string className, string tooltip)
        {
            var data = new PushButtonData(name, text, assemblyPath, className)
            {
                ToolTip = tooltip,
                LargeImage = LoadImage(assemblyPath, "braves_logo_32.png"),
                Image = LoadImage(assemblyPath, "braves_logo_16.png"),
            };
            panel.AddItem(data);
        }

        // Same 16x16/32x32 constraint as BravesBimFieldImporter's BravesApplication:
        // Revit does not scale these, so the source PNGs must already be exactly
        // that size (and at 96 DPI) or the icon silently fails to render.
        private static BitmapImage? LoadImage(string assemblyPath, string fileName)
        {
            string path = Path.Combine(Path.GetDirectoryName(assemblyPath)!, "Resources", fileName);
            if (!File.Exists(path)) return null;

            var image = new BitmapImage();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.UriSource = new Uri(path, UriKind.Absolute);
            image.EndInit();
            image.Freeze();
            return image;
        }
    }
}
