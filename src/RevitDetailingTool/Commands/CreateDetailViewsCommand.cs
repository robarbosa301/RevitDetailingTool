using System.Collections.Generic;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitDetailingTool.Services;

namespace RevitDetailingTool.Commands
{
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class CreateDetailViewsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            Document doc = uidoc.Document;
            View activeView = doc.ActiveView;

            bool viewSupportsCallout =
                activeView.ViewType == ViewType.FloorPlan ||
                activeView.ViewType == ViewType.CeilingPlan ||
                activeView.ViewType == ViewType.Section ||
                activeView.ViewType == ViewType.Elevation ||
                activeView.ViewType == ViewType.Detail;

            if (!viewSupportsCallout)
            {
                message = "Ative uma planta, corte, elevação ou vista de detalhe antes de executar este comando.";
                return Result.Failed;
            }

            List<(XYZ Min, XYZ Max)> regions = DetailViewService.GetRegionsFromSelection(uidoc, doc);
            if (regions.Count == 0)
            {
                TaskDialog.Show("Criar Vistas de Detalhe",
                    "Selecione um ou mais elementos (ou Grupos, um grupo = um detalhe) que delimitam " +
                    "a área de cada vista de detalhe antes de executar o comando.");
                return Result.Cancelled;
            }

            ElementId detailViewTypeId = DetailViewService.GetDefaultDetailViewFamilyTypeId(doc);
            if (detailViewTypeId == ElementId.InvalidElementId)
            {
                message = "Nenhum tipo de vista de detalhe (Detail View) foi encontrado no projeto.";
                return Result.Failed;
            }

            int created = 0;
            using (Transaction tx = new Transaction(doc, "Criar Vistas de Detalhe"))
            {
                tx.Start();
                foreach (var region in regions)
                {
                    DetailViewService.CreateCalloutForRegion(doc, activeView, detailViewTypeId, region, created + 1);
                    created++;
                }
                tx.Commit();
            }

            TaskDialog.Show("Criar Vistas de Detalhe", $"{created} vista(s) de detalhe criada(s) com sucesso.");
            return Result.Succeeded;
        }
    }
}
