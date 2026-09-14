using System.Collections.Generic;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.Exceptions;
using Autodesk.Revit.UI;
using RevitDetailingTool.Services;

namespace RevitDetailingTool.Commands
{
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class AutoAnnotateCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            Document doc = uidoc.Document;
            View view = doc.ActiveView;

            var window = new UI.AnnotationWindow();
            bool? ok = window.ShowDialog();
            if (ok != true) return Result.Cancelled;

            if (window.TagCategories.Count > 0)
            {
                int tagCount;
                using (Transaction tx = new Transaction(doc, "Anotação Automática - Tags"))
                {
                    tx.Start();
                    tagCount = AnnotationService.TagUntaggedElements(doc, view, window.TagCategories);
                    tx.Commit();
                }
                TaskDialog.Show("Anotação Automática", $"{tagCount} tag(s) criada(s).");
            }

            if (window.CreateDimensions)
            {
                try
                {
                    XYZ p1 = uidoc.Selection.PickPoint("Clique no primeiro ponto da linha de cotagem");
                    XYZ p2 = uidoc.Selection.PickPoint("Clique no segundo ponto da linha de cotagem");
                    Line pickedLine = Line.CreateBound(p1, p2);

                    using Transaction tx2 = new Transaction(doc, "Anotação Automática - Cotas");
                    tx2.Start();
                    IList<Reference> refs = AnnotationService.CollectWallFaceReferences(doc, view, pickedLine);
                    Dimension? dim = AnnotationService.CreateDimensionAlongLine(doc, view, pickedLine, refs);
                    tx2.Commit();

                    if (dim == null)
                    {
                        TaskDialog.Show("Anotação Automática", "Não foram encontradas ao menos duas faces de parede cruzando a linha escolhida.");
                    }
                }
                catch (OperationCanceledException)
                {
                    // Usuário cancelou a seleção de pontos (Esc).
                }
            }

            return Result.Succeeded;
        }
    }
}
