using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace BravesBimFieldImporter
{
    public class FirestoreConfig
    {
        public string apiKey;
        public string projectId;
    }

    public class ProjectMeta
    {
        public string Code;
        public string Name;
        public string Address;
        public DateTime UpdatedAt;
        public string Display => string.IsNullOrEmpty(Address) ? $"{Name}  ({Code})" : $"{Name}  ({Code}) — {Address}";
    }

    // Talks to the same Firestore project the web app uses (see src/firebase.js
    // and src/storage.js in the main repo) via its public REST API — no
    // service account needed, same open rules the app already relies on.
    public static class FirestoreClient
    {
        public static FirestoreConfig LoadConfig()
        {
            string dllDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string path = Path.Combine(dllDir ?? ".", "firebase.config.json");
            if (!File.Exists(path))
                throw new InvalidOperationException(
                    "Arquivo firebase.config.json não encontrado em:\n" + dllDir +
                    "\n\nCrie esse arquivo com as credenciais do seu projeto Firebase " +
                    "(as mesmas do .env do app) — veja o README do add-in.");

            FirestoreConfig config = JsonConvert.DeserializeObject<FirestoreConfig>(File.ReadAllText(path));
            if (config == null || string.IsNullOrWhiteSpace(config.apiKey) || string.IsNullOrWhiteSpace(config.projectId))
                throw new InvalidOperationException("firebase.config.json está sem \"apiKey\" ou \"projectId\".");

            return config;
        }

        private static string BaseUrl(FirestoreConfig cfg) =>
            $"https://firestore.googleapis.com/v1/projects/{cfg.projectId}/databases/(default)/documents";

        // HttpClient.GetStringAsync only reports the status code on failure — the
        // Firestore error body (which names the real reason: rules, disabled API,
        // bad key, etc.) gets silently discarded. Read it ourselves so failures are
        // diagnosable from the Revit error dialog alone.
        private static string GetJsonOrThrow(HttpClient http, string url)
        {
            HttpResponseMessage response = http.GetAsync(url).GetAwaiter().GetResult();
            string body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException(
                    $"Firestore respondeu {(int)response.StatusCode} ({response.ReasonPhrase}):\n{body}");
            return body;
        }

        public static List<ProjectMeta> ListProjects(FirestoreConfig cfg)
        {
            var result = new List<ProjectMeta>();
            using (var http = new HttpClient())
            {
                string url = $"{BaseUrl(cfg)}/projects?key={Uri.EscapeDataString(cfg.apiKey)}&pageSize=300";
                string json = GetJsonOrThrow(http, url);
                JObject obj = JObject.Parse(json);
                if (!(obj["documents"] is JArray documents)) return result;

                foreach (JToken docToken in documents)
                {
                    JObject fields = docToken["fields"] as JObject;
                    string name = (string)fields?["name"]?["stringValue"] ?? "(sem nome)";
                    string address = (string)fields?["address"]?["stringValue"] ?? "";
                    string code = (string)fields?["code"]?["stringValue"];
                    string docName = (string)docToken["name"];
                    if (string.IsNullOrEmpty(code) && !string.IsNullOrEmpty(docName))
                        code = docName.Substring(docName.LastIndexOf('/') + 1);

                    DateTime updatedAt = DateTime.MinValue;
                    string updatedRaw = (string)fields?["updatedAt"]?["timestampValue"];
                    if (!string.IsNullOrEmpty(updatedRaw)) DateTime.TryParse(updatedRaw, out updatedAt);

                    if (!string.IsNullOrEmpty(code))
                        result.Add(new ProjectMeta { Code = code, Name = name, Address = address, UpdatedAt = updatedAt });
                }
            }
            return result;
        }

        public static LevantamentoSchema FetchSchema(FirestoreConfig cfg, string code)
        {
            using (var http = new HttpClient())
            {
                string docId = Uri.EscapeDataString($"bim-project:{code}:data");
                string url = $"{BaseUrl(cfg)}/kv/{docId}?key={Uri.EscapeDataString(cfg.apiKey)}";
                string json = GetJsonOrThrow(http, url);
                JObject obj = JObject.Parse(json);

                string outerValue = (string)obj["fields"]?["value"]?["stringValue"];
                if (string.IsNullOrEmpty(outerValue))
                    throw new InvalidOperationException("Esse projeto ainda não tem dados sincronizados na nuvem.");

                JObject payload = JObject.Parse(outerValue);
                string schemaJson = (string)payload["schema_json"];
                if (string.IsNullOrEmpty(schemaJson))
                    throw new InvalidOperationException(
                        "Esse projeto foi sincronizado antes do schema_json existir. Abra o levantamento no " +
                        "app e faça qualquer alteração (mesmo pequena) pra gerar uma nova sincronização, depois tente de novo.");

                return JsonConvert.DeserializeObject<LevantamentoSchema>(schemaJson);
            }
        }
    }
}
