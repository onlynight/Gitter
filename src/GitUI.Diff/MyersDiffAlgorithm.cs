namespace GitUI.Diff;

/// <summary>编辑脚本操作类型。</summary>
internal enum DiffOpKind : byte
{
    Equal,
    Delete,
    Insert,
}

/// <summary>
/// 编辑脚本的一个操作（作用在已 intern 的整型序列上）。
/// Equal：消费 a[OldIdx] 与 b[NewIdx]；Delete：消费 a[OldIdx]，NewIdx 是当前新序列位置；
/// Insert：消费 b[NewIdx]，OldIdx 是当前旧序列位置（即插入点，0 基）。
/// </summary>
internal readonly record struct DiffOp(DiffOpKind Kind, int OldIdx, int NewIdx);

/// <summary>步数预算耗尽。作为内部控制流使用，由调用方捕获并退化为整段替换。</summary>
internal sealed class StepBudgetExceededException : Exception
{
    public static readonly StepBudgetExceededException Instance = new();
    private StepBudgetExceededException() : base("Myers diff step budget exhausted.") { }
}

/// <summary>
/// 确定性步数预算。蛇步与对角线迭代都计数，超限即抛
/// <see cref="StepBudgetExceededException"/>，调用方退化为"整段删除 + 整段插入"
/// （结果仍然正确，只是块划分不是最小编辑脚本——git xdiff 同款兜底思路）。
/// </summary>
internal sealed class StepBudget
{
    public StepBudget(long total) => Remaining = total;

    public long Remaining { get; private set; }

    public bool Exhausted => Remaining <= 0;

    public void Step()
    {
        if (--Remaining <= 0) throw StepBudgetExceededException.Instance;
    }
}

/// <summary>
/// Myers O(ND) 差分算法，线性空间分治变体（Myers 1986 §4b middle snake）。
/// 输入是 intern 后的整型数组，整数相等即行相等。
/// </summary>
internal static class MyersDiffAlgorithm
{
    // 递归深度保险丝：middle snake 每层至少消耗一个编辑，正常深度远小于此。
    private const int MaxDepth = 8192;

    /// <summary>
    /// 计算 a[0..aLen) 与 b[0..bLen) 的编辑脚本，按序追加到 <paramref name="ops"/>。
    /// 预算耗尽时对剩余窗口整体替换（保证终止与正确性）。
    /// </summary>
    public static void Compute(int[] a, int[] b, List<DiffOp> ops, long stepBudget)
    {
        ComputeRange(a, 0, a.Length, b, 0, b.Length, ops, new StepBudget(stepBudget), 0);
    }

    /// <summary>窗口版入口，供 <see cref="MyersDiffEngine"/> 的锚点分割直接调用。</summary>
    internal static void ComputeRange(
        int[] a, int a0, int a1, int[] b, int b0, int b1,
        List<DiffOp> ops, StepBudget budget, int depth)
    {
        // 公共前缀
        while (a0 < a1 && b0 < b1 && a[a0] == b[b0])
        {
            ops.Add(new DiffOp(DiffOpKind.Equal, a0, b0));
            a0++; b0++;
        }

        // 公共后缀（先摘下来，递归结束后统一回填，保证输出顺序）
        int suffix = 0;
        while (a1 > a0 && b1 > b0 && a[a1 - 1] == b[b1 - 1]) { a1--; b1--; suffix++; }

        if (a0 == a1)
        {
            for (int j = b0; j < b1; j++) ops.Add(new DiffOp(DiffOpKind.Insert, a0, j));
        }
        else if (b0 == b1)
        {
            for (int i = a0; i < a1; i++) ops.Add(new DiffOp(DiffOpKind.Delete, i, b0));
        }
        else if (budget.Exhausted || depth >= MaxDepth)
        {
            EmitWholeReplace(a, a0, a1, b, b0, b1, ops);
        }
        else
        {
            try
            {
                var (x, y, u, v) = FindMiddleSnake(a, a0, a1, b, b0, b1, budget);
                ComputeRange(a, a0, a0 + x, b, b0, b0 + y, ops, budget, depth + 1);
                for (int k = 0; k < u; k++)
                    ops.Add(new DiffOp(DiffOpKind.Equal, a0 + x + k, b0 + y + k));
                ComputeRange(a, a0 + x + u, a1, b, b0 + y + v, b1, ops, budget, depth + 1);
            }
            catch (StepBudgetExceededException)
            {
                EmitWholeReplace(a, a0, a1, b, b0, b1, ops);
            }
        }

        for (int k = 0; k < suffix; k++)
            ops.Add(new DiffOp(DiffOpKind.Equal, a1 + k, b1 + k));
    }

    private static void EmitWholeReplace(
        int[] a, int a0, int a1, int[] b, int b0, int b1, List<DiffOp> ops)
    {
        for (int i = a0; i < a1; i++) ops.Add(new DiffOp(DiffOpKind.Delete, i, b0));
        for (int j = b0; j < b1; j++) ops.Add(new DiffOp(DiffOpKind.Insert, a1, j));
    }

    /// <summary>
    /// 在窗口 [a0,a1) × [b0,b1) 内寻找 middle snake，返回实际坐标系下的
    /// (x, y, u, v)：蛇从 (x,y) 前进 (u,v) 到达中点交会处。
    /// </summary>
    private static (int X, int Y, int U, int V) FindMiddleSnake(
        int[] a, int a0, int a1, int[] b, int b0, int b1, StepBudget budget)
    {
        int n = a1 - a0, m = b1 - b0;
        int delta = n - m;
        bool odd = (delta & 1) != 0;
        int maxD = (n + m + 1) / 2;
        int off = maxD; // k + off 落在 [0, 2*maxD]

        // 每次调用独立分配，保证线程安全（xunit 并行测试 / GitWorker 单 worker 均可）。
        var vf = new int[2 * maxD + 2];
        var vb = new int[2 * maxD + 2];
        vf[1 + off] = 0;
        vb[1 + off] = 0;

        for (int d = 0; d <= maxD; d++)
        {
            budget.Step();

            // 前向：Vf[k] = 对角线 k 上 d 步可达的最远 x
            for (int k = -d; k <= d; k += 2)
            {
                budget.Step();
                int x;
                if (k == -d || (k != d && vf[k - 1 + off] < vf[k + 1 + off]))
                    x = vf[k + 1 + off];
                else
                    x = vf[k - 1 + off] + 1;
                int y = x - k;
                int x0 = x, y0 = y;
                while (x < n && y < m && a[a0 + x] == b[b0 + y]) { x++; y++; budget.Step(); }
                vf[k + off] = x;

                // delta 为奇数时前向与落后一步的后向路径交会（2d-1 条非对角线）
                if (odd && delta - (d - 1) <= k && k <= delta + (d - 1)
                    && x + vb[delta - k + off] >= n)
                {
                    return (x0, y0, x - x0, y - y0);
                }
            }

            // 后向：Vb[k] = 反向对角线 k 上 d 步可达的最远反向 x（距末端的距离）
            for (int k = -d; k <= d; k += 2)
            {
                budget.Step();
                int xr;
                if (k == -d || (k != d && vb[k - 1 + off] < vb[k + 1 + off]))
                    xr = vb[k + 1 + off];
                else
                    xr = vb[k - 1 + off] + 1;
                int yr = xr - k;
                int xr0 = xr, yr0 = yr;
                while (xr < n && yr < m && a[a1 - 1 - xr] == b[b1 - 1 - yr]) { xr++; yr++; budget.Step(); }
                vb[k + off] = xr;

                // delta 为偶数时两向同步交会（2d 条非对角线）。
                // 反向对角线 k 对应实际对角线 delta-k；xr + Vf[delta-k] >= n 即重叠。
                if (!odd && delta - d <= k && k <= delta + d
                    && xr + vf[delta - k + off] >= n)
                {
                    // 反向坐标转实际坐标：蛇起点 = (n - xr, m - yr)（延伸最远处），
                    // 终点 = (n - xr0, m - yr0)（延伸前），长度 = xr - xr0（延伸量）。
                    return (n - xr, m - yr, xr - xr0, yr - yr0);
                }
            }
        }

        // 理论不可达（maxD 覆盖全部可能编辑距离）；防御性退化为整段替换。
        throw StepBudgetExceededException.Instance;
    }
}
