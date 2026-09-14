using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;

namespace RevitDetailingTool.Services
{
    /// <summary>
    /// Regras de negócio para extração de parâmetros de elementos e exportação para CSV.
    /// </summary>
    public static class ParameterExtractionService
    {
        public static List<Element> GetElementsByCategory(Document doc, BuiltInCategory category, bool activeViewOnly, View view)
        {
            FilteredElementCollector collector = activeViewOnly
                ? new FilteredElementCollector(doc, view.Id)
                : new FilteredElementCollector(doc);

            return collector.OfCategory(category).WhereElementIsNotElementType().ToList();
        }

        public static List<string> GetAvailableParameterNames(IList<Element> elements)
        {
            var names = new SortedSet<string>();
            foreach (Element el in elements.Take(25))
            {
                foreach (Parameter p in el.Parameters)
                {
                    if (!string.IsNullOrEmpty(p.Definition?.Name))
                        names.Add(p.Definition.Name);
                }
            }
            return names.ToList();
        }

        public static void ExportToCsv(string filePath, IList<Element> elements, IList<string> parameterNames)
        {
            using var writer = new StreamWriter(filePath, false, Encoding.UTF8);

            var header = new List<string> { "Id", "Categoria" };
            header.AddRange(parameterNames);
            writer.WriteLine(string.Join(";", header.Select(EscapeCsv)));

            foreach (Element el in elements)
            {
                var values = new List<string> { el.Id.ToString(), el.Category?.Name ?? string.Empty };
                foreach (string paramName in parameterNames)
                {
                    Parameter? p = el.LookupParameter(paramName);
                    values.Add(GetParameterValueAsString(p));
                }
                writer.WriteLine(string.Join(";", values.Select(EscapeCsv)));
            }
        }

        private static string GetParameterValueAsString(Parameter? p)
        {
            if (p == null) return string.Empty;

            return p.StorageType switch
            {
                StorageType.String => p.AsString() ?? string.Empty,
                StorageType.Integer => p.AsInteger().ToString(CultureInfo.InvariantCulture),
                StorageType.Double => p.AsValueString() ?? p.AsDouble().ToString(CultureInfo.InvariantCulture),
                StorageType.ElementId => p.AsValueString() ?? p.AsElementId().ToString(),
                _ => string.Empty
            };
        }

        private static string EscapeCsv(string value)
        {
            if (value.Contains(';') || value.Contains('"') || value.Contains('\n'))
                return "\"" + value.Replace("\"", "\"\"") + "\"";
            return value;
        }
    }
}
