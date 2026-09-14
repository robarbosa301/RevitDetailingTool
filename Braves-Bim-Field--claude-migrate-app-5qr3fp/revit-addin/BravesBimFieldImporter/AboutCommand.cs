using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace BravesBimFieldImporter
{
    // Purely informational — the third ribbon button (logo + "Braves BIM
    // Field") exists so the brand shows next to the Cloud/Import commands,
    // same idea as the "About" button most commercial add-ins have.
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class AboutCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            TaskDialog.Show(
                "Braves BIM Field",
                "Braves BIM Field\nBRAVES Engenharia\n\nLevantamento de campo integrado ao Revit.");
            return Result.Succeeded;
        }
    }
}
