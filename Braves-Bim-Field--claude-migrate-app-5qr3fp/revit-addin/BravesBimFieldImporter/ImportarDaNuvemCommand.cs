using System;
using System.Windows.Forms;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace BravesBimFieldImporter
{
    // Imports a levantamento straight from Firestore, picked by project
    // name — no exported file, no manual transfer from the phone/tablet.
    // Requires firebase.config.json next to the add-in DLL (see README).
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class ImportarDaNuvemCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            Document doc = commandData.Application.ActiveUIDocument.Document;

            FirestoreConfig config;
            try
            {
                config = FirestoreClient.LoadConfig();
            }
            catch (Exception ex)
            {
                TaskDialog.Show("Braves BIM Field", ex.Message);
                return Result.Cancelled;
            }

            System.Collections.Generic.List<ProjectMeta> projects;
            try
            {
                projects = FirestoreClient.ListProjects(config);
            }
            catch (Exception ex)
            {
                TaskDialog.Show("Braves BIM Field", "Erro ao buscar projetos na nuvem:\n\n" + ex.Message);
                return Result.Cancelled;
            }

            if (projects.Count == 0)
            {
                TaskDialog.Show("Braves BIM Field", "Nenhum projeto encontrado na nuvem ainda. Faça algum levantamento no app primeiro (ele sincroniza sozinho).");
                return Result.Cancelled;
            }

            using (var picker = new ProjectPickerForm(projects))
            {
                if (picker.ShowDialog() != DialogResult.OK || picker.Selected == null)
                    return Result.Cancelled;

                try
                {
                    LevantamentoSchema schema = FirestoreClient.FetchSchema(config, picker.Selected.Code);
                    ImportResult result = LevantamentoImporter.Importar(doc, schema);
                    TaskDialog.Show("Braves BIM Field", $"\"{picker.Selected.Name}\" importado:\n" + result);
                    return Result.Succeeded;
                }
                catch (Exception ex)
                {
                    message = "Erro ao importar: " + ex.Message;
                    return Result.Failed;
                }
            }
        }
    }
}
