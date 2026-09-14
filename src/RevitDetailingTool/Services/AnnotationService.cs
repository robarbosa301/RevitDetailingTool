using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace RevitDetailingTool.Services
{
    /// <summary>
    /// Regras de negócio para anotação automática: tags por categoria e cotas em cadeia.
    /// </summary>
    public static class AnnotationService
    {
        /// <summary>Deve ser chamado dentro de uma Transaction aberta.</summary>
        public static int TagUntaggedElements(Document doc, View view, IList<BuiltInCategory> categories)
        {
            var taggedElementIds = new FilteredElementCollector(doc, view.Id)
                .OfClass(typeof(IndependentTag))
                .Cast<IndependentTag>()
                .SelectMany(t => t.GetTaggedLocalElementIds())
                .ToHashSet();

            int count = 0;
            foreach (BuiltInCategory bic in categories)
            {
                var candidates = new FilteredElementCollector(doc, view.Id)
                    .OfCategory(bic)
                    .WhereElementIsNotElementType()
                    .ToElements();

                foreach (Element el in candidates)
                {
                    if (taggedElementIds.Contains(el.Id)) continue;

                    XYZ? point = (el.Location as LocationPoint)?.Point
                        ?? (el.Location as LocationCurve)?.Curve.Evaluate(0.5, true);
                    if (point == null) continue;

                    var reference = new Reference(el);
                    IndependentTag.Create(doc, view.Id, reference, false, TagMode.TM_ADDBY_CATEGORY, TagOrientation.Horizontal, point);
                    count++;
                }
            }
            return count;
        }

        /// <summary>
        /// Coleta referências de faces de paredes cruzadas por uma linha de cotagem escolhida pelo usuário.
        /// </summary>
        public static IList<Reference> CollectWallFaceReferences(Document doc, View view, Line pickedLine)
        {
            var references = new List<Reference>();

            var walls = new FilteredElementCollector(doc, view.Id)
                .OfCategory(BuiltInCategory.OST_Walls)
                .WhereElementIsNotElementType()
                .Cast<Wall>();

            var options = new Options { View = view, ComputeReferences = true };

            foreach (Wall wall in walls)
            {
                GeometryElement geomElem = wall.get_Geometry(options);
                if (geomElem == null) continue;

                foreach (GeometryObject geomObj in geomElem)
                {
                    if (geomObj is not Solid solid || solid.Faces.Size == 0) continue;

                    foreach (Face face in solid.Faces)
                    {
                        if (face is not PlanarFace planarFace) continue;
                        if (!IsFaceCrossedByLine(planarFace, pickedLine)) continue;

                        if (face.Reference != null)
                        {
                            references.Add(face.Reference);
                            break;
                        }
                    }
                }
            }

            return references;
        }

        /// <summary>Deve ser chamado dentro de uma Transaction aberta.</summary>
        public static Dimension? CreateDimensionAlongLine(Document doc, View view, Line pickedLine, IList<Reference> references)
        {
            if (references.Count < 2) return null;

            var refArray = new ReferenceArray();
            foreach (Reference r in references) refArray.Append(r);

            return doc.Create.NewDimension(view, pickedLine, refArray);
        }

        private static bool IsFaceCrossedByLine(PlanarFace face, Line line)
        {
            SetComparisonResult result = face.Intersect(line, out IntersectionResultArray results);
            return result == SetComparisonResult.Overlap && results != null && results.Size > 0;
        }
    }
}
