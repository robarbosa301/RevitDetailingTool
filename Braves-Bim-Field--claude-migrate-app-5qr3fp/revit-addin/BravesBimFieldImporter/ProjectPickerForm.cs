using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows.Forms;

namespace BravesBimFieldImporter
{
    // Simple searchable picker: type part of the project's name, pick from
    // the filtered list. Built in code (no .Designer.cs/.resx) to keep the
    // add-in a single small assembly.
    public class ProjectPickerForm : Form
    {
        private readonly List<ProjectMeta> _all;
        private readonly TextBox _search;
        private readonly ListBox _list;

        public ProjectMeta Selected { get; private set; }

        public ProjectPickerForm(List<ProjectMeta> projects)
        {
            _all = projects.OrderByDescending(p => p.UpdatedAt).ToList();

            Text = "Braves BIM Field — Escolher levantamento";
            Width = 480;
            Height = 420;
            StartPosition = FormStartPosition.CenterScreen;
            MinimizeBox = false;
            MaximizeBox = false;
            FormBorderStyle = FormBorderStyle.FixedDialog;

            var searchLabel = new Label { Text = "Nome do projeto:", Left = 12, Top = 12, Width = 200 };

            _search = new TextBox { Left = 12, Top = 34, Width = 440 };
            _search.TextChanged += (s, e) => Filter();

            _list = new ListBox { Left = 12, Top = 64, Width = 440, Height = 280, DisplayMember = "Display" };
            _list.DoubleClick += (s, e) => Confirm();

            var ok = new Button { Text = "Abrir", Left = 296, Top = 352, Width = 75, DialogResult = DialogResult.OK };
            ok.Click += (s, e) => Confirm();

            var cancel = new Button { Text = "Cancelar", Left = 377, Top = 352, Width = 75, DialogResult = DialogResult.Cancel };

            Controls.Add(searchLabel);
            Controls.Add(_search);
            Controls.Add(_list);
            Controls.Add(ok);
            Controls.Add(cancel);

            AcceptButton = ok;
            CancelButton = cancel;

            Filter();
        }

        private void Filter()
        {
            string term = _search.Text.Trim();
            List<ProjectMeta> filtered = string.IsNullOrEmpty(term)
                ? _all
                : _all.Where(p => p.Name.IndexOf(term, StringComparison.OrdinalIgnoreCase) >= 0).ToList();

            _list.DataSource = null;
            _list.DisplayMember = "Display";
            _list.DataSource = filtered;
        }

        private void Confirm()
        {
            if (_list.SelectedItem is ProjectMeta meta)
            {
                Selected = meta;
                DialogResult = DialogResult.OK;
                Close();
            }
            else if (_list.Items.Count == 1)
            {
                Selected = (ProjectMeta)_list.Items[0];
                DialogResult = DialogResult.OK;
                Close();
            }
        }
    }
}
