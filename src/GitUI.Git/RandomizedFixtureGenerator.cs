namespace GitUI.Git
{
    /// <summary>
    /// 描述一个可参数化生成的仓库拓扑。每个 <see cref="TopologySpec"/> 都能用任意随机种子
    /// 复现，用于让集成测试覆盖"随机生成的 20 个不同拓扑"这一验收项。
    /// </summary>
    public sealed class TopologySpec
    {
        public required string Id { get; init; }
        public required Func<GitFixtureBuilder, Random, int> Builder { get; init; }

        /// <summary>该拓扑预期的提交总数（不含 unborn HEAD）。</summary>
        public int? ExpectedCommitCount { get; init; }

        /// <summary>该拓扑预期产生的合并提交数。</summary>
        public int? ExpectedMergeCount { get; init; }
    }

    /// <summary>
    /// 生成一批确定性的随机拓扑。固定种子保证可复现，
    /// 每个测试可以断言"在 20 个不同拓扑上全绿"而不是只跑一条固定路径。
    /// </summary>
    public static class RandomizedFixtureGenerator
    {
        /// <summary>返回 20 个覆盖不同拓扑形状的生成器。</summary>
        public static IReadOnlyList<TopologySpec> Generate20()
        {
            return new List<TopologySpec>
            {
                new() { Id = "linear-8", Builder = (b, r) => LinearChain(b, 8 + r.Next(4)), ExpectedCommitCount = null },
                new() { Id = "linear-25", Builder = (b, r) => LinearChain(b, 25) },
                new() { Id = "two-branches-merge", Builder = (b, r) => TwoBranchMerge(b, 3 + r.Next(3), 2 + r.Next(3)), ExpectedMergeCount = 1 },
                new() { Id = "three-way-merge", Builder = (b, r) => ThreeWayMerge(b, 4, 3 + r.Next(2), 2 + r.Next(2)), ExpectedMergeCount = 1 },
                new() { Id = "octopus-merge", Builder = (b, r) => OctopusMerge(b, 3 + r.Next(2), 2 + r.Next(2)), ExpectedMergeCount = 1 },
                new() { Id = "sequential-merges", Builder = (b, r) => SequentialMerges(b, 3, 2), ExpectedMergeCount = 2 },
                new() { Id = "nested-merges", Builder = (b, r) => NestedMerges(b), ExpectedMergeCount = 2 },
                new() { Id = "cherry-pick", Builder = (b, r) => CherryPickTopology(b, 4, 2), ExpectedMergeCount = 0 },
                new() { Id = "cherry-pick-conflict", Builder = (b, r) => CherryPickConflict(b), ExpectedMergeCount = 0 },
                new() { Id = "detached-head", Builder = (b, r) => DetachedHead(b, 3) },
                new() { Id = "deep-linear-100", Builder = (b, r) => LinearChain(b, 100) },
                new() { Id = "wide-fanout", Builder = (b, r) => WideFanout(b, 6, 2 + r.Next(2)), ExpectedMergeCount = 0 },
                new() { Id = "diamond-merge", Builder = (b, r) => DiamondMerge(b), ExpectedMergeCount = 2 },
                new() { Id = "empty-commits", Builder = (b, r) => EmptyCommits(b, 5) },
                new() { Id = "many-files", Builder = (b, r) => ManyFiles(b, 8 + r.Next(5)) },
                new() { Id = "nested-dirs", Builder = (b, r) => NestedDirs(b) },
                new() { Id = "unicode-names", Builder = (b, r) => UnicodeNames(b) },
                new() { Id = "file-rename", Builder = (b, r) => FileRename(b) },
                new() { Id = "large-blob", Builder = (b, r) => LargeBlob(b) },
                new() { Id = "multi-author", Builder = (b, r) => MultiAuthor(b, 4) },
            };
        }

        public static int LinearChain(GitFixtureBuilder b, int count)
        {
            for (int i = 1; i <= count; i++)
                b.Commit($"c{i}", ("f.txt", $"line{i}\n"));
            return count;
        }

        public static int TwoBranchMerge(GitFixtureBuilder b, int mainExtra, int branchExtra)
        {
            b.Commit("base", ("f.txt", "base\n"));
            var branchBase = b.Sha("HEAD");
            b.Branch("feature", branchBase);
            b.Checkout("main");
            for (int i = 1; i <= mainExtra; i++) b.Commit($"main{i}", ("main.txt", $"m{i}\n"));
            b.Checkout("feature");
            for (int i = 1; i <= branchExtra; i++) b.Commit($"feat{i}", ("feat.txt", $"f{i}\n"));
            b.Checkout("main");
            b.Merge("merge feature", "feature");
            return 1 + mainExtra + branchExtra + 1;
        }

        public static int ThreeWayMerge(GitFixtureBuilder b, int baseCount, int aExtra, int bExtra)
        {
            b.Commit("root", ("f.txt", "root\n"));
            b.Branch("a", b.Sha("HEAD"));
            b.Branch("b", b.Sha("HEAD"));
            b.Checkout("a");
            for (int i = 1; i <= aExtra; i++) b.Commit($"a{i}", ("a.txt", $"a{i}\n"));
            b.Checkout("b");
            for (int i = 1; i <= bExtra; i++) b.Commit($"b{i}", ("b.txt", $"b{i}\n"));
            b.Checkout("main");
            b.Merge("merge a", "a");
            b.Merge("merge b", "b");
            return 1 + aExtra + bExtra + 2;
        }

        public static int OctopusMerge(GitFixtureBuilder b, int nBranches, int branchCommits)
        {
            b.Commit("root", ("f.txt", "root\n"));
            for (int i = 0; i < nBranches; i++) b.Branch($"br{i}", b.Sha("HEAD"));
            var names = new List<string>();
            for (int i = 0; i < nBranches; i++)
            {
                b.Checkout($"br{i}");
                for (int j = 1; j <= branchCommits; j++) b.Commit($"{i}-{j}", ($"f{i}.txt", $"{i}-{j}\n"));
                names.Add($"br{i}");
            }
            b.Checkout("main");
            RunGit(b, "merge -m \"octopus\" " + string.Join(" ", names));
            return 1 + nBranches * branchCommits + 1;
        }

        public static int SequentialMerges(GitFixtureBuilder b, int mainExtra, int branchExtra)
        {
            b.Commit("base", ("f.txt", "base\n"));
            b.Branch("v1", b.Sha("HEAD"));
            b.Commit("main-c", ("m.txt", "m\n"));
            b.Checkout("v1");
            for (int i = 1; i <= branchExtra; i++) b.Commit($"v1-{i}", ($"v1{i}.txt", $"{i}\n"));
            b.Checkout("main");
            b.Merge("merge v1", "v1");
            b.Branch("v2", b.Sha("HEAD"));
            b.Commit("main-d", ("m2.txt", "d\n"));
            b.Checkout("v2");
            for (int i = 1; i <= branchExtra; i++) b.Commit($"v2-{i}", ($"v2{i}.txt", $"{i}\n"));
            b.Checkout("main");
            b.Merge("merge v2", "v2");
            return 2 + 1 + branchExtra + 1 + 1 + branchExtra + 1;
        }

        public static int NestedMerges(GitFixtureBuilder b)
        {
            b.Commit("root", ("f.txt", "root\n"));
            b.Branch("feat", b.Sha("HEAD"));
            b.Checkout("feat");
            b.Commit("feat-1", ("a.txt", "a1\n"));
            b.Branch("sub", b.Sha("HEAD"));
            b.Checkout("sub");
            b.Commit("sub-1", ("b.txt", "b1\n"));
            b.Checkout("feat");
            b.Merge("merge sub", "sub");
            b.Checkout("main");
            b.Commit("main-1", ("c.txt", "c1\n"));
            b.Merge("merge feat", "feat");
            return 6;
        }

        public static int CherryPickTopology(GitFixtureBuilder b, int mainCount, int branchExtra)
        {
            b.Commit("root", ("f.txt", "root\n"));
            for (int i = 1; i < mainCount; i++) b.Commit($"m{i}", ($"m{i}.txt", $"{i}\n"));
            // 从 feature 分支上挑一个 main 从未见过的提交来 cherry-pick，
            // 避开 "already applied" 与 "cherry-pick is now empty"。
            b.Branch("feature", b.Sha("HEAD"));
            b.Commit("main-more", ("extra.txt", "x\n"));
            b.Checkout("feature");
            for (int i = 1; i <= branchExtra; i++) b.Commit($"f{i}", ($"f{i}.txt", $"{i}\n"));
            b.Checkout("main");
            b.CherryPick(b.Sha("feature"));
            return mainCount + 1 + branchExtra + 1;
        }

        public static int CherryPickConflict(GitFixtureBuilder b)
        {
            b.Commit("root", ("f.txt", "v1\n"));
            var src = b.Sha("HEAD");
            b.Branch("feature", src);
            b.Commit("main-change", ("f.txt", "main\n"));
            b.Checkout("feature");
            b.Commit("feat-change", ("f.txt", "feat\n"));
            b.Checkout("main");
            // cherry-pick 会冲突；不提交
            return 3;
        }

        public static int DetachedHead(GitFixtureBuilder b, int count)
        {
            for (int i = 1; i <= count; i++) b.Commit($"c{i}", ($"f{i}.txt", $"{i}\n"));
            RunGit(b, $"checkout --detach {b.Sha($"HEAD~1")}");
            return count;
        }

        public static int WideFanout(GitFixtureBuilder b, int branches, int commitsPerBranch)
        {
            b.Commit("root", ("f.txt", "root\n"));
            for (int i = 0; i < branches; i++) b.Branch($"b{i}", b.Sha("HEAD"));
            for (int i = 0; i < branches; i++)
            {
                b.Checkout($"b{i}");
                for (int j = 1; j <= commitsPerBranch; j++) b.Commit($"{i}-{j}", ($"f{i}-{j}.txt", $"{i}.{j}\n"));
            }
            b.Checkout("main");
            return 1 + branches * commitsPerBranch;
        }

        public static int DiamondMerge(GitFixtureBuilder b)
        {
            b.Commit("A", ("f.txt", "A\n"));
            b.Branch("p1", b.Sha("HEAD"));
            b.Branch("p2", b.Sha("HEAD"));
            b.Checkout("p1"); b.Commit("p1-1", ("a.txt", "a\n"));
            b.Checkout("p2"); b.Commit("p2-1", ("b.txt", "b\n"));
            b.Checkout("main");
            b.Merge("merge p1", "p1");
            b.Merge("merge p2", "p2");
            return 5;
        }

        public static int EmptyCommits(GitFixtureBuilder b, int count)
        {
            for (int i = 1; i <= count; i++) b.Commit($"empty-{i}");
            return count;
        }

        public static int ManyFiles(GitFixtureBuilder b, int files)
        {
            var pairs = new (string, string)[files];
            for (int i = 0; i < files; i++) pairs[i] = ($"f{i}.txt", $"{i}\n");
            b.Commit("many", pairs);
            return 1;
        }

        public static int NestedDirs(GitFixtureBuilder b)
        {
            b.Commit("root",
                ("a/x.txt", "ax\n"),
                ("a/b/y.txt", "ay\n"),
                ("a/b/c/z.txt", "z\n"));
            return 1;
        }

        public static int UnicodeNames(GitFixtureBuilder b)
        {
            b.Commit("unicode",
                ("文件.txt", "content\n"),
                ("日本語/名前.txt", "にほんご\n"));
            return 1;
        }

        public static int FileRename(GitFixtureBuilder b)
        {
            b.Commit("before", ("old.txt", "keep\n"));
            // 用 --move 让 git 检测到 rename，而不是 mv 到新文件
            RunGit(b, "mv old.txt new.txt");
            b.Commit("renamed", ("new.txt", "keep\n"));
            return 2;
        }

        public static int LargeBlob(GitFixtureBuilder b)
        {
            var content = string.Concat(Enumerable.Repeat("lorem ipsum dolor sit amet\n", 2000));
            b.Commit("large", ("big.txt", content));
            return 1;
        }

        public static int MultiAuthor(GitFixtureBuilder b, int count)
        {
            for (int i = 0; i < count; i++)
            {
                var author = $"author{i}@x";
                RunGit(b, $"commit --allow-empty -q -m \"a{i}\" --author \"{author} <{author}>\"");
            }
            return count;
        }

        private static void RunGit(GitFixtureBuilder b, string args)
        {
            var psi = new System.Diagnostics.ProcessStartInfo("git")
            {
                Arguments = args,
                WorkingDirectory = b.WorkDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var p = System.Diagnostics.Process.Start(psi)!;
            var so = p.StandardOutput.ReadToEnd();
            var se = p.StandardError.ReadToEnd();
            p.WaitForExit(60_000);
            if (p.ExitCode != 0)
                throw new InvalidOperationException($"git {args} failed ({p.ExitCode}): {se}");
        }
    }
}
