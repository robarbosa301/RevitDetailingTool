using System.Diagnostics;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;

namespace RevitDetailingTool.Commands
{
    /// <summary>
    /// Abre uma janela do PowerShell navegada para D:\ROG\BBF e já executando o Claude Code.
    /// </summary>
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class OpenClaudeCodeCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoExit -Command \"cd 'D:\\ROG\\BBF'; claude\"",
                UseShellExecute = true
            };

            Process.Start(startInfo);
            return Result.Succeeded;
        }
    }
}
