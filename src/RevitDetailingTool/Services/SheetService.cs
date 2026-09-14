using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace RevitDetailingTool.Services
{
    /// <summary>
    /// Regras de negócio para criação de pranchas e posicionamento automático de vistas.
    /// </summary>
    public static class SheetService
    {
        public static List<FamilySymbol> GetTitleBlockTypes(Document doc)
        {
            return new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_TitleBlocks)
                .WhereElementIsElementType()
                .Cast<FamilySymbol>()
                .OrderBy(f => f.FamilyName).ThenBy(f => f.Name)
                .ToList();
        }

        public static List<View> GetUnplacedViews(Document doc)
        {
            var placedViewIds = new FilteredElementCollector(doc)
                .OfClass(typeof(Viewport))
                .Cast<Viewport>()
                .Select(vp => vp.ViewId)
                .ToHashSet();

            return new FilteredElementCollector(doc)
                .OfClass(typeof(View))
                .Cast<View>()
                .Where(v => !v.IsTemplate && v.CanBePrinted && !placedViewIds.Contains(v.Id))
                .OrderBy(v => v.Name)
                .ToList();
        }

        /// <summary>Deve ser chamado dentro de uma Transaction aberta.</summary>
        public static ViewSheet CreateSheet(Document doc, ElementId titleBlockTypeId, string number, string name)
        {
            ViewSheet sheet = ViewSheet.Create(doc, titleBlockTypeId);
            sheet.SheetNumber = number;
            sheet.Name = name;
            return sheet;
        }

        /// <summary>
        /// Posiciona as vistas informadas em um layout de grade dentro da área útil da prancha.
        /// Deve ser chamado dentro de uma Transaction aberta.
        /// </summary>
        public static void PlaceViewsInGrid(Document doc, ViewSheet sheet, IList<View> views, int columns, double marginMm = 20)
        {
            if (views.Count == 0 || columns < 1) return;

            BoundingBoxUV outline = sheet.Outline;
            double margin = UnitUtils.ConvertToInternalUnits(marginMm, UnitTypeId.Millimeters);

            double usableWidth = Math.Max(outline.Max.U - outline.Min.U - margin * 2, margin);
            double usableHeight = Math.Max(outline.Max.V - outline.Min.V - margin * 2, margin);

            int rows = (int)Math.Ceiling(views.Count / (double)columns);
            double cellWidth = usableWidth / columns;
            double cellHeight = usableHeight / rows;

            for (int i = 0; i < views.Count; i++)
            {
                View view = views[i];
                if (!Viewport.CanAddViewToSheet(doc, sheet.Id, view.Id)) continue;

                int col = i % columns;
                int row = i / columns;

                double centerU = outline.Min.U + margin + cellWidth * (col + 0.5);
                double centerV = outline.Max.V - margin - cellHeight * (row + 0.5);

                Viewport.Create(doc, sheet.Id, view.Id, new XYZ(centerU, centerV, 0));
            }
        }
    }
}
