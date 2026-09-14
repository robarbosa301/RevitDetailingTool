using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Microsoft.Win32;
using RevitDetailingTool.Services;

namespace RevitDetailingTool.Commands
{
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class ExportParametersCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            Document doc = uidoc.Document;
            View view = doc.ActiveView;

            var window = new UI.ParameterExportWindow(doc, view);
            bool? ok = window.ShowDialog();
            if (ok != true) return Result.Cancelled;

            var saveDialog = new SaveFileDialog
            {
                Filter = "CSV (*.csv)|*.csv",
                FileName = $"parametros_{window.SelectedCategory}_{DateTime.Now:yyyyMMdd_HHmm}.csv"
            };
            if (saveDialog.ShowDialog() != true) return Result.Cancelled;

            ParameterExtractionService.ExportToCsv(saveDialog.FileName, window.FilteredElements, window.SelectedParameters);

            TaskDialog.Show("Exportar Parâmetros", $"{window.FilteredElements.Count} elemento(s) exportado(s) para:\n{saveDialog.FileName}");
            return Result.Succeeded;
        }
    }
}
