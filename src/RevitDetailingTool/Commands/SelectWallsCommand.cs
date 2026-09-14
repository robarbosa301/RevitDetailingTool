using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitDetailingTool.Commands
{
    /// <summary>
    /// Seleciona todas as paredes visíveis na vista ativa (atalho útil antes de
    /// "Criar Vistas de Detalhe", já que a seleção define a região do callout).
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class SelectWallsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            Document doc = uidoc.Document;
            View view = doc.ActiveView;

            var wallIds = new FilteredElementCollector(doc, view.Id)
                .OfCategory(BuiltInCategory.OST_Walls)
                .WhereElementIsNotElementType()
                .ToElementIds();

            if (wallIds.Count == 0)
            {
                TaskDialog.Show("Selecionar Paredes", "Nenhuma parede encontrada na vista ativa.");
                return Result.Cancelled;
            }

            uidoc.Selection.SetElementIds(wallIds);
            TaskDialog.Show("Selecionar Paredes", $"{wallIds.Count} parede(s) selecionada(s).");
            return Result.Succeeded;
        }
    }
}
