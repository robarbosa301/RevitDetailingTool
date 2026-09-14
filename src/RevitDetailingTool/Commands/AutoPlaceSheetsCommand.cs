using System.Collections.Generic;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitDetailingTool.Services;

namespace RevitDetailingTool.Commands
{
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class AutoPlaceSheetsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            Document doc = uidoc.Document;

            List<FamilySymbol> titleBlocks = SheetService.GetTitleBlockTypes(doc);
            if (titleBlocks.Count == 0)
            {
                TaskDialog.Show("Criar Pranchas", "Nenhum tipo de carimbo (Title Block) carregado no projeto.");
                return Result.Cancelled;
            }

            List<View> unplacedViews = SheetService.GetUnplacedViews(doc);
            if (unplacedViews.Count == 0)
            {
                TaskDialog.Show("Criar Pranchas", "Não há vistas sem prancha disponíveis para posicionar.");
                return Result.Cancelled;
            }

            var window = new UI.SheetsWindow(titleBlocks, unplacedViews);
            bool? ok = window.ShowDialog();
            if (ok != true) return Result.Cancelled;

            using (Transaction tx = new Transaction(doc, "Criar Prancha e Posicionar Vistas"))
            {
                tx.Start();
                ViewSheet sheet = SheetService.CreateSheet(doc, window.SelectedTitleBlockId, window.SheetNumber, window.SheetName);
                SheetService.PlaceViewsInGrid(doc, sheet, window.SelectedViews, window.Columns);
                tx.Commit();
            }

            TaskDialog.Show("Criar Pranchas", "Prancha criada e vistas posicionadas com sucesso.");
            return Result.Succeeded;
        }
    }
}
