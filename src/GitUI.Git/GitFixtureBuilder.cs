using System.Diagnostics;
using System.Text;

namespace GitUI.Git
{
    /// <summary>
    /// 用 git CLI 构造测试仓库。设计文档 §8 S1 要求"用 <c>git commit-tree</c> 手工构造
    /// 含分支、合并、cherry-pick 的拓扑"，因此本类走 CLI 而不是 libgit2sharp——CLI 暴露的
    /// <c>commit-tree</c>/<c>mktree</c>/<c>update-ref</c> 是最灵活的手工拓扑构造手段。
    ///
    /// 每个实例独占一个临时目录，隔离 <c>HOME</c> 避免污染调用方的全局 git 配置。
    /// </summary>
    public sealed class GitFixtureBuilder : IDisposable
    {
        private readonly string _workDir;
        private readonly string _homeDir;
        private bool _disposed;

        private GitFixtureBuilder(string workDir, string homeDir)
        {
            _workDir = workDir;
            _homeDir = homeDir;
        }

        /// <summary>初始化一个新的 fixture 仓库。</summary>
        /// <param name="workDir">工作目录（不存在则创建）。</param>
        /// <param name="defaultBranch">默认分支名。</param>
        public static GitFixtureBuilder Init(string workDir, string defaultBranch = "main")
        {
            Directory.CreateDirectory(workDir);
            var home = Path.Combine(workDir, ".home");
            Directory.CreateDirectory(home);
            Run(workDir, home, "init", "-q", "-b", defaultBranch, ".");
            // core.autocrlf=false 保证 blob 内容与写入内容逐字节一致（Windows 下默认会转 CRLF）
            Run(workDir, home, "config", "core.autocrlf", "false");
            Run(workDir, home, "config", "core.longpaths", "true");
            // 中文/日文路径按原样输出，不做八进制转义（design.md §9 风险表 S2 项）
            Run(workDir, home, "config", "core.quotepath", "false");
            Run(workDir, home, "config", "user.email", "fixture@gitui.test");
            Run(workDir, home, "config", "user.name", "Fixture");
            return new GitFixtureBuilder(workDir, home);
        }

        /// <summary>提交一次工作区变更，返回提交 SHA。时间戳取自内置时钟（逐次 +1s，确定性）。</summary>
        public string Commit(string message, params (string file, string content)[] files)
            => CommitOn(message, _clockBase.AddSeconds(_nextTimestamp++), files);

        /// <summary>
        /// 在指定时间提交一次工作区变更，返回提交 SHA。
        /// S4 的按天分组测试用它构造跨天的确定性提交。
        /// </summary>
        public string CommitOn(string message, DateTimeOffset when, params (string file, string content)[] files)
        {
            _nextTimestamp++;
            // "u" 格式（2009-06-15 13:45:30Z）转 UTC，git 的 GIT_AUTHOR_DATE/GIT_COMMITTER_DATE 均接受
            var dateStamp = when.ToUniversalTime().ToString("u");

            if (files.Length == 0)
            {
                RunWithDate(_workDir, _homeDir, dateStamp,
                    "commit", "--allow-empty", "-m", message);
                return Sha("HEAD");
            }
            foreach (var (file, content) in files)
            {
                var full = Path.Combine(_workDir, file.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(full)!);
                File.WriteAllText(full, content);
                Run(_workDir, _homeDir, "add", "-f", file);
            }
            RunWithDate(_workDir, _homeDir, dateStamp, "commit", "-m", message);
            return Sha("HEAD");
        }

        private int _nextTimestamp;
        private readonly DateTimeOffset _clockBase = DateTimeOffset.UtcNow.AddSeconds(-10);

        /// <summary>创建一个分支指向指定提交。unborn 时（<paramref name="fromSha"/> 为 null）创建空分支。</summary>
        public string Branch(string name, string? fromSha)
        {
            if (fromSha is null)
                Run(_workDir, _homeDir, "update-ref", $"refs/heads/{name}", "");
            else
                Run(_workDir, _homeDir, "update-ref", $"refs/heads/{name}", fromSha);
            return Sha($"refs/heads/{name}");
        }

        /// <summary>切换当前 HEAD 到指定分支。</summary>
        public void Checkout(string name)
        {
            Run(_workDir, _homeDir, "switch", name);
        }

        /// <summary>在当前分支追加一个合并提交。返回合并提交 SHA。</summary>
        public string Merge(string message, string fromBranch)
        {
            // --no-ff 保证产生真正的合并提交而非快进
            Run(_workDir, _homeDir, "merge", "--no-ff", "-m", message, fromBranch);
            return Sha("HEAD");
        }

        /// <summary>把指定提交 cherry-pick 到当前分支。</summary>
        public string CherryPick(string sourceSha)
        {
            Run(_workDir, _homeDir, "cherry-pick", sourceSha);
            return Sha("HEAD");
        }

        /// <summary>创建工作区文件但不提交，用于制造未提交变更。</summary>
        public void Write(string file, string content)
        {
            var full = Path.Combine(_workDir, file.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, content);
        }

        /// <summary>从工作区删除文件（不提交）。</summary>
        public void Delete(string file)
        {
            File.Delete(Path.Combine(_workDir, file.Replace('/', Path.DirectorySeparatorChar)));
        }

        /// <summary>
        /// 用 <c>git fast-import</c> 一次性灌入 count 个线性提交（性能基准专用）。
        /// 每个提交修改同一文件的第 i 行，时间戳逐秒递增，保证顺序确定。
        /// 单进程完成全部提交，避免逐个 Commit 的进程启动开销。
        /// </summary>
        public void BulkCommits(int count, string file = "f.txt", string branch = "main")
        {
            var sb = new StringBuilder();
            var baseTs = new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);
            for (int i = 1; i <= count; i++)
            {
                var msg = $"c{i}\n";
                var content = $"line{i}\n";
                var ts = baseTs.AddSeconds(i).ToUnixTimeSeconds();
                sb.Append("commit refs/heads/").Append(branch).Append('\n');
                sb.Append("mark :").Append(i).Append('\n');
                sb.Append("author Fixture <fixture@gitui.test> ").Append(ts).Append(" +0000\n");
                sb.Append("committer Fixture <fixture@gitui.test> ").Append(ts).Append(" +0000\n");
                sb.Append("data ").Append(Encoding.UTF8.GetByteCount(msg)).Append('\n').Append(msg);
                sb.Append("M 100644 inline ").Append(file).Append('\n');
                sb.Append("data ").Append(Encoding.UTF8.GetByteCount(content)).Append('\n').Append(content);
            }

            var psi = new ProcessStartInfo("git", EscapeArgs(new[] { "fast-import", "--quiet" }))
            {
                WorkingDirectory = _workDir,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.Environment["HOME"] = _homeDir;
            psi.Environment["GIT_CONFIG_GLOBAL"] = Path.Combine(_homeDir, "config");
            psi.Environment["GIT_CONFIG_SYSTEM"] = Path.Combine(_homeDir, "does-not-exist.ini");

            using var process = Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to start git fast-import.");
            process.StandardInput.Write(sb.ToString());
            process.StandardInput.Close();

            var stderr = process.StandardError.ReadToEnd();
            process.WaitForExit(120_000);
            if (process.ExitCode != 0)
                throw new InvalidOperationException($"git fast-import exited {process.ExitCode}: {stderr}");

            // fast-import 只改 refs 和对象库，index / 工作区仍是 init 时的空状态，
            // 会让 RetrieveStatus 把 HEAD 里的文件报成 Staged。reset --hard 对齐三者。
            Run(_workDir, _homeDir, "reset", "-q", "--hard");

            // 写 commit-graph：现代 Git（2.24+，gc.writeCommitGraph 默认开）在 gc 时自动维护，
            // 真实大仓库普遍存在；fast-import 不会生成，这里补上以贴近真实形态。
            Run(_workDir, _homeDir, "commit-graph", "write", "--reachable");

            _nextTimestamp += count;
        }

        /// <summary>把指定路径加入 index（staged）。</summary>
        public void Stage(string file) => Run(_workDir, _homeDir, "add", "-f", file);

        /// <summary>从 index 移除指定路径。</summary>
        public void Unstage(string file) => Run(_workDir, _homeDir, "reset", "HEAD", "--", file);

        /// <summary>初始化一个 bare 仓库（S5 push 测试的远程端）。返回路径。</summary>
        public static string InitBare(string path)
        {
            Directory.CreateDirectory(path);
            var psi = new ProcessStartInfo("git", EscapeArgs(new[] { "init", "-q", "--bare", "-b", "main", path }))
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var p = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start git.");
            p.WaitForExit(30_000);
            if (p.ExitCode != 0)
                throw new InvalidOperationException($"git init --bare exited {p.ExitCode}");
            return path;
        }

        /// <summary>添加远程仓库。</summary>
        public void AddRemote(string name, string url)
            => Run(_workDir, _homeDir, "remote", "add", name, url);

        /// <summary>HEAD reflog 行（"%H %gs"，含 commit/checkout/reset 等事件）。</summary>
        public IReadOnlyList<string> Reflog()
        {
            var outp = Run(_workDir, _homeDir, "reflog", "--format=%H %gs");
            return outp.Length == 0
                ? Array.Empty<string>()
                : outp.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        }

        /// <summary>读取某 rev 下文件内容（git show rev:path）。</summary>
        public string ShowFile(string rev, string path)
            => Run(_workDir, _homeDir, "show", $"{rev}:{path}");

        /// <summary>在隔离 HOME 的本仓库内执行任意 git 命令（S5/S6 测试辅助）。</summary>
        public string RunGit(params string[] args) => Run(_workDir, _homeDir, args);

        /// <summary>执行 git 命令并注入确定性 GIT_AUTHOR_DATE / GIT_COMMITTER_DATE（同秒提交会让
        /// rev-list 与显式排序的同分 tie-break 不一致，跨路径对照测试必须用稳定日期）。</summary>
        public string RunGitWithDate(string dateStamp, params string[] args)
            => Run(_workDir, _homeDir, args, dateStamp);

        /// <summary>在任意目录执行 git 命令（无 HOME 隔离；bare 仓库/clone 辅助）。显式注入测试身份。</summary>
        public static string RunGitIn(string dir, params string[] args)
        {
            var full = new List<string>(args);
            // -c 参数需放在子命令前
            var psi = new ProcessStartInfo("git")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = dir,
            };
            psi.ArgumentList.Add("-c");
            psi.ArgumentList.Add("user.name=test");
            psi.ArgumentList.Add("-c");
            psi.ArgumentList.Add("user.email=test@test");
            foreach (var a in full) psi.ArgumentList.Add(a);

            using var p = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start git.");
            var stdout = p.StandardOutput.ReadToEnd();
            var stderr = p.StandardError.ReadToEnd();
            p.WaitForExit(60_000);
            if (p.ExitCode != 0)
                throw new InvalidOperationException($"git {string.Join(' ', args)} exited {p.ExitCode}: {stderr}");
            return stdout.TrimEnd('\r', '\n');
        }

        /// <summary>解析任意 rev 表达式到完整 SHA。</summary>
        public string Sha(string rev)
        {
            if (string.IsNullOrEmpty(rev))
                throw new ArgumentException("rev must not be empty", nameof(rev));
            var sha = Run(_workDir, _homeDir, "rev-parse", rev);
            if (string.IsNullOrWhiteSpace(sha))
                throw new InvalidOperationException($"rev '{rev}' resolved to empty (unborn HEAD?).");
            return sha;
        }

        /// <summary>解析 rev 对应的提交数（从该 rev 可达）。</summary>
        public int Count(string rev)
        {
            var outp = Run(_workDir, _homeDir, "rev-list", "--count", rev);
            return int.Parse(outp);
        }

        /// <summary>列出所有本地分支名（不含前缀）。</summary>
        public IReadOnlyList<string> BranchNames()
        {
            var outp = Run(_workDir, _homeDir, "for-each-ref", "--format=%(refname:short)", "refs/heads/");
            return outp.Split('\n', StringSplitOptions.RemoveEmptyEntries).ToList();
        }

        /// <summary>父提交数，用于断言是否为合并提交。</summary>
        public int ParentCount(string sha)
        {
            var p = Run(_workDir, _homeDir, "rev-parse", $"{sha}^@");
            return p.Length == 0 ? 0 : p.Split('\n', StringSplitOptions.RemoveEmptyEntries).Length;
        }

        /// <summary>返回该 rev 的拓扑日志行，用于断言 DAG 形状。</summary>
        public IReadOnlyList<string> Topology(string rev)
        {
            var outp = Run(_workDir, _homeDir, "log", "--pretty=format:%H", rev);
            return outp.Split('\n', StringSplitOptions.RemoveEmptyEntries).ToList();
        }

        public string WorkDir => _workDir;

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            try { Directory.Delete(_workDir, recursive: true); } catch { /* 尽力清理 */ }
        }

        private static string Run(string workDir, string home, params string[] args)
            => Run(workDir, home, args, dateStamp: null);

        /// <summary>Run git with an optional deterministic date stamp applied via environment.</summary>
        private static string Run(string workDir, string home, string[] args, string? dateStamp)
        {
            var psi = new ProcessStartInfo("git", EscapeArgs(args))
            {
                WorkingDirectory = workDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.Environment["HOME"] = home;
            psi.Environment["GIT_CONFIG_GLOBAL"] = Path.Combine(home, "config");
            psi.Environment["GIT_CONFIG_SYSTEM"] = Path.Combine(home, "does-not-exist.ini");
            if (dateStamp is not null)
            {
                psi.Environment["GIT_AUTHOR_DATE"] = dateStamp;
                psi.Environment["GIT_COMMITTER_DATE"] = dateStamp;
            }

            using var process = Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to start git.");

            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            process.WaitForExit(60_000);
            if (process.ExitCode != 0)
            {
                throw new InvalidOperationException(
                    $"git {EscapeArgs(args)} exited {process.ExitCode}.\nstdout: {stdout}\nstderr: {stderr}");
            }
            return stdout.TrimEnd('\r', '\n');
        }

        private static string RunWithDate(string workDir, string home, string dateStamp, params string[] args)
            => Run(workDir, home, args, dateStamp);

        /// <summary>
        /// 逐参数引号转义后以空格连接。git 由 native 解析 argv，带引号的参数保持为单个 token，
        /// 因此提交信息里的空格不会再被拆成多个位置参数。
        /// </summary>
        private static string EscapeArgs(string[] args) =>
            string.Join(" ", args.Select(Escape));

        private static string Escape(string arg)
        {
            if (string.IsNullOrEmpty(arg)) return "\"\"";
            if (arg.All(c => !char.IsWhiteSpace(c) && c != '"' && c != '\\'
                              && c != '*' && c != '[' && c != '!'))
                return arg;
            return "\"" + arg.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }
    }
}
