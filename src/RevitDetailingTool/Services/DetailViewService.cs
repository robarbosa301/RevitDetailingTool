using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitDetailingTool.Services
{
    /// <summary>
    /// Regras de negócio para criação automática de vistas de detalhe (callouts).
    /// </summary>
    public static class DetailViewService
    {
        /// <summary>
        /// Calcula uma região retangular (min/max) por item selecionado: um Group vira uma região,
        /// e o restante da seleção é combinado em uma única região.
        /// </summary>
        public static List<(XYZ Min, XYZ Max)> GetRegionsFromSelection(UIDocument uidoc, Document doc)
        {
            var regions = new List<(XYZ, XYZ)>();
            ICollection<ElementId> selectedIds = uidoc.Selection.GetElementIds();
            if (selectedIds.Count == 0) return regions;

            View activeView = doc.ActiveView;
            var groups = selectedIds.Select(id => doc.GetElement(id)).OfType<Group>().ToList();

            if (groups.Count > 0)
            {
                foreach (Group group in groups)
                {
                    BoundingBoxXYZ bbox = group.get_BoundingBox(activeView);
                    if (bbox != null) regions.Add((bbox.Min, bbox.Max));
                }
                return regions;
            }

            BoundingBoxXYZ? overall = null;
            foreach (ElementId id in selectedIds)
            {
                Element el = doc.GetElement(id);
                BoundingBoxXYZ bb = el.get_BoundingBox(activeView);
                if (bb == null) continue;
                overall = overall == null ? bb : Union(overall, bb);
            }

            if (overall != null) regions.Add((overall.Min, overall.Max));
            return regions;
        }

        private static BoundingBoxXYZ Union(BoundingBoxXYZ a, BoundingBoxXYZ b)
        {
            return new BoundingBoxXYZ
            {
                Min = new XYZ(Math.Min(a.Min.X, b.Min.X), Math.Min(a.Min.Y, b.Min.Y), Math.Min(a.Min.Z, b.Min.Z)),
                Max = new XYZ(Math.Max(a.Max.X, b.Max.X), Math.Max(a.Max.Y, b.Max.Y), Math.Max(a.Max.Z, b.Max.Z))
            };
        }

        public static ElementId GetDefaultDetailViewFamilyTypeId(Document doc)
        {
            ViewFamilyType? type = new FilteredElementCollector(doc)
                .OfClass(typeof(ViewFamilyType))
                .Cast<ViewFamilyType>()
                .FirstOrDefault(t => t.ViewFamily == ViewFamily.Detail);

            return type?.Id ?? ElementId.InvalidElementId;
        }

        /// <summary>
        /// Cria um callout de detalhe na vista proprietária, delimitado pela região informada.
        /// Deve ser chamado dentro de uma Transaction aberta.
        /// </summary>
        public static ViewSection CreateCalloutForRegion(Document doc, View ownerView, ElementId viewFamilyTypeId, (XYZ Min, XYZ Max) region, int index)
        {
            ViewSection callout = ViewSection.CreateCallout(doc, ownerView.Id, viewFamilyTypeId, region.Min, region.Max);
            callout.Name = MakeUniqueName(doc, $"DETALHE {index:00}");
            callout.DetailLevel = ViewDetailLevel.Fine;
            return callout;
        }

        private static string MakeUniqueName(Document doc, string baseName)
        {
            var existing = new FilteredElementCollector(doc)
                .OfClass(typeof(View))
                .Cast<View>()
                .Select(v => v.Name)
                .ToHashSet();

            if (!existing.Contains(baseName)) return baseName;

            int i = 2;
            while (existing.Contains($"{baseName} ({i})")) i++;
            return $"{baseName} ({i})";
        }
    }
}
