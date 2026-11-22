// OrangeDisk launcher + installer (single source, two builds)
// launcher  : csc ... -out:OrangeDisk.exe
// installer : csc ... /define:INSTALLER /resource:payload.zip,payload.zip -out:OrangeDisk-Setup.exe
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Management;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    const string AppName = "橙盘";
    const string Version = "1.2.0";
    const string Publisher = "OrangeDisk";
    const string ExeName = "OrangeDisk.exe";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\OrangeDisk";

#if UPDATER
    const string WindowTitle = "更新 橙盘";
    const string ActionLabel = "更新";
#else
    const string WindowTitle = "安装 橙盘";
    const string ActionLabel = "安装";
#endif

    static string BaseDir
    {
        get
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Programs\OrangeDisk");
        }
    }

    static string ProfileDir
    {
        get
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "OrangeDisk");
        }
    }

    static string IconPath { get { return Path.Combine(BaseDir, "icon.ico"); } }

    static string LogPath
    {
        get { return Path.Combine(Path.GetTempPath(), "OrangeDisk-install.log"); }
    }

    static void Log(string msg)
    {
        try
        {
            File.AppendAllText(LogPath,
                DateTime.Now.ToString("HH:mm:ss.fff") + " " + msg + Environment.NewLine);
        }
        catch { }
    }

    [STAThread]
    static void Main(string[] args)
    {
        Log("main args=[" + string.Join(",", args) + "] exe=" + Assembly.GetExecutingAssembly().Location);
        AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e)
        {
            Log("UNHANDLED " + (e.ExceptionObject as Exception));
        };
#if INSTALLER
        InstallerMain(args);
#else
        if (args.Length > 0 && string.Equals(args[0], "--uninstall", StringComparison.OrdinalIgnoreCase))
        {
            Uninstall(args);
            return;
        }
        Launch();
#endif
    }

    /* ---------------- 启动应用 ---------------- */

    static void Launch()
    {
        // 安装器在临时目录里运行时，要启动的是安装目录里的那份
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        if (File.Exists(Path.Combine(BaseDir, "node.exe"))) dir = BaseDir;

        string node = Path.Combine(dir, "node.exe");
        string server = Path.Combine(dir, @"app\server.mjs");

        if (!File.Exists(node) || !File.Exists(server))
        {
            MessageBox.Show("安装文件不完整，请重新运行安装包。", AppName,
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var psi = new ProcessStartInfo(node, "\"" + server + "\"");
        psi.WorkingDirectory = Path.Combine(dir, "app");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WindowStyle = ProcessWindowStyle.Hidden;

        try
        {
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show("启动失败：" + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    /* ---------------- 结束正在运行的实例 ---------------- */

    static void KillRunning()
    {
        int self = Process.GetCurrentProcess().Id;
        foreach (Process p in Process.GetProcesses())
        {
            try
            {
                if (p.Id == self) continue;
                string path = p.MainModule == null ? null : p.MainModule.FileName;
                if (path != null && path.StartsWith(BaseDir, StringComparison.OrdinalIgnoreCase))
                {
                    p.Kill();
                }
            }
            catch { }
        }

        // 使用独立 profile 的 Edge 应用窗口
        try
        {
            using (var searcher = new ManagementObjectSearcher(
                "select ProcessId,CommandLine from Win32_Process where Name='msedge.exe'"))
            {
                foreach (ManagementBaseObject mo in searcher.Get())
                {
                    string cmd = mo["CommandLine"] as string;
                    if (cmd != null && cmd.IndexOf(@"OrangeDisk\browser", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        try { Process.GetProcessById(Convert.ToInt32(mo["ProcessId"])).Kill(); }
                        catch { }
                    }
                }
            }
        }
        catch { }

        Thread.Sleep(400);
    }

    /* ---------------- 快捷方式 ---------------- */

    static void MakeShortcut(string path, string target, string arguments)
    {
        object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        object lnk = shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod,
            null, shell, new object[] { path });
        Type t = lnk.GetType();
        t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { target });
        t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { BaseDir });
        t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { IconPath + ",0" });
        t.InvokeMember("Description", BindingFlags.SetProperty, null, lnk,
            new object[] { "橙盘 · 查看磁盘 / 文件夹 / 应用占用" });
        if (!string.IsNullOrEmpty(arguments))
        {
            t.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { arguments });
        }
        t.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
    }

    static void CreateShortcuts()
    {
        string exe = Path.Combine(BaseDir, ExeName);
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "橙盘");
        Directory.CreateDirectory(menu);

        MakeShortcut(Path.Combine(desktop, "橙盘.lnk"), exe, null);
        MakeShortcut(Path.Combine(menu, "橙盘.lnk"), exe, null);
        MakeShortcut(Path.Combine(menu, "卸载橙盘.lnk"), exe, "--uninstall");
    }

    static void DeleteShortcuts()
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "橙盘");
        TryDelete(Path.Combine(desktop, "橙盘.lnk"));
        TryDelete(Path.Combine(menu, "橙盘.lnk"));
        TryDelete(Path.Combine(menu, "卸载橙盘.lnk"));
        try { Directory.Delete(menu, true); } catch { }
    }

    static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    /* ---------------- 卸载 ---------------- */

    static void Uninstall(string[] args)
    {
        bool quiet = Array.IndexOf(args, "--quiet") >= 0 || Array.IndexOf(args, "/quiet") >= 0;

        if (!quiet)
        {
            DialogResult r = MessageBox.Show(
                "确定要卸载 橙盘 吗？\r\n\r\n程序文件和快捷方式会被删除，磁盘上的其他文件不受影响。",
                "卸载 橙盘", MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
            if (r != DialogResult.OK) return;
        }

        KillRunning();
        DeleteShortcuts();
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
        try { if (Directory.Exists(ProfileDir)) Directory.Delete(ProfileDir, true); } catch { }

        string dir = BaseDir;
        try
        {
            Process.Start(new ProcessStartInfo("cmd.exe",
                "/c ping -n 3 127.0.0.1 > nul & rmdir /s /q \"" + dir + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            });
        }
        catch { }

        Log("uninstalled quiet=" + quiet);
        if (!quiet)
        {
            MessageBox.Show("已卸载 橙盘。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    /* ---------------- 安装 ---------------- */

#if INSTALLER
    static void InstallerMain(string[] args)
    {
        bool quiet = Array.IndexOf(args, "/quiet") >= 0 || Array.IndexOf(args, "/S") >= 0;
        Log("installer quiet=" + quiet);

        if (quiet)
        {
            try
            {
                DoInstall(null);
                Log("install ok");
            }
            catch (Exception ex)
            {
                Log("install failed: " + ex);
                MessageBox.Show(ex.Message, ActionLabel + "失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.Exit(1);
            }
            Launch();
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        InstallForm form = new InstallForm();
        form.Shown += delegate
        {
            Task.Run(delegate
            {
                DateTime started = DateTime.UtcNow;
                string error = null;
                try
                {
                    DoInstall(delegate(int percent, string text)
                    {
                        try { form.BeginInvoke(new Action(delegate { form.SetStatus(percent, text); })); }
                        catch { }
                    });
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }
                // 装得太快时也让窗口露个脸，别一闪而过
                int elapsed = (int)(DateTime.UtcNow - started).TotalMilliseconds;
                if (error == null && elapsed < 1600) Thread.Sleep(1600 - elapsed);
                try { form.BeginInvoke(new Action(delegate { form.Finish(error); })); }
                catch { }
            });
        };
        Application.Run(form);

        if (!form.Failed) Launch();
    }

    static void DoInstall(Action<int, string> report)
    {
        Log("DoInstall start -> " + BaseDir);
#if UPDATER
        if (!File.Exists(Path.Combine(BaseDir, ExeName)))
        {
            throw new Exception("还没有安装橙盘，请先运行完整安装包（OrangeDisk-Setup）。");
        }
#endif
        if (report != null) report(2, "正在结束已运行的橙盘…");
        KillRunning();
        Log("killed running");

        Directory.CreateDirectory(BaseDir);
        Log("dir created");

        Assembly asm = Assembly.GetExecutingAssembly();
        Log("resources: " + string.Join(",", asm.GetManifestResourceNames()));
        using (Stream s = asm.GetManifestResourceStream("payload.zip"))
        {
            if (s == null) throw new Exception("安装包内容缺失，请重新下载。");
            using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                int total = 0;
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    if (e.FullName.EndsWith("/")) continue;
                    total++;
                }
                if (total == 0) throw new Exception("安装包内容为空。");

                int done = 0;
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    string name = e.FullName.Replace('/', Path.DirectorySeparatorChar);
                    string dest = Path.Combine(BaseDir, name);
                    if (e.Name.Length == 0)
                    {
                        Directory.CreateDirectory(dest);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    e.ExtractToFile(dest, true);
                    done++;
                    if (report != null) report(4 + (int)(86.0 * done / total), "正在复制 " + e.Name);
                }
            }
        }

        if (report != null) report(92, "正在创建快捷方式…");
        CreateShortcuts();

        if (report != null) report(97, "正在注册卸载信息…");
        RegisterUninstall();

        if (report != null) report(100, ActionLabel + "完成");
    }

    static void RegisterUninstall()
    {
        string exe = Path.Combine(BaseDir, ExeName);
        long size = 0;
        try
        {
            foreach (string f in Directory.GetFiles(BaseDir, "*", SearchOption.AllDirectories))
            {
                size += new FileInfo(f).Length;
            }
        }
        catch { }

        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            k.SetValue("DisplayName", "橙盘 OrangeDisk");
            k.SetValue("DisplayVersion", Version);
            k.SetValue("Publisher", Publisher);
            k.SetValue("InstallLocation", BaseDir);
            k.SetValue("DisplayIcon", IconPath);
            k.SetValue("UninstallString", "\"" + exe + "\" --uninstall");
            k.SetValue("QuietUninstallString", "\"" + exe + "\" --uninstall --quiet");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", (int)(size / 1024), RegistryValueKind.DWord);
        }
    }

    class InstallForm : Form
    {
        readonly Label _sub;
        readonly Label _pct;
        readonly Panel _track;
        readonly Panel _fill;
        public bool Failed { get; private set; }

        public InstallForm()
        {
            Text = WindowTitle;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(460, 196);
            BackColor = Color.FromArgb(253, 249, 245);
            Font = new Font("Microsoft YaHei UI", 9F);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            var title = new Label();
            title.Text = "橙盘 · OrangeDisk";
            title.Left = 28; title.Top = 22; title.Width = 404; title.Height = 28;
            title.Font = new Font("Microsoft YaHei UI", 14F, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(43, 33, 25);
            title.BackColor = Color.Transparent;

            _sub = new Label();
            _sub.Text = "正在准备" + ActionLabel + "…";
            _sub.Left = 28; _sub.Top = 58; _sub.Width = 404; _sub.Height = 20;
            _sub.ForeColor = Color.FromArgb(125, 107, 91);
            _sub.BackColor = Color.Transparent;

            _track = new Panel();
            _track.Left = 28; _track.Top = 102; _track.Width = 404; _track.Height = 8;
            _track.BackColor = Color.FromArgb(248, 239, 230);

            _fill = new Panel();
            _fill.Left = 0; _fill.Top = 0; _fill.Width = 0; _fill.Height = 8;
            _fill.BackColor = Color.FromArgb(249, 115, 22);
            _track.Controls.Add(_fill);

            _pct = new Label();
            _pct.Text = "0%";
            _pct.Left = 28; _pct.Top = 118; _pct.Width = 404; _pct.Height = 18;
            _pct.TextAlign = ContentAlignment.MiddleRight;
            _pct.ForeColor = Color.FromArgb(169, 152, 138);
            _pct.BackColor = Color.Transparent;

            Controls.Add(title);
            Controls.Add(_sub);
            Controls.Add(_track);
            Controls.Add(_pct);
        }

        public void SetStatus(int percent, string text)
        {
            if (percent < 0) percent = 0;
            if (percent > 100) percent = 100;
            _fill.Width = _track.Width * percent / 100;
            _pct.Text = percent + "%";
            if (!string.IsNullOrEmpty(text)) _sub.Text = text;
        }

        public void Finish(string error)
        {
            Failed = error != null;
            if (Failed)
            {
                MessageBox.Show(this, error, ActionLabel + "失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            else
            {
                SetStatus(100, ActionLabel + "完成，正在启动…");
            }
            Close();
        }
    }
#endif
}
