using System.IO.Pipes;
using System.Text;
using GitUI.Git;
using GitUI.Git.Mcp;

namespace GitUI.App;

/// <summary>
/// GUI 内置的 MCP 命名管道宿主（ai-native-redesign.md §7.2：本机命名管道传输形态）：
/// agent 连接 <c>\\.\pipe\gitui-mcp</c> 即可访问当前仓库的结构化 git 工具；
/// 写工具走人审确认卡（<see cref="GitterMcpServerOptions"/> 的 WriteApproval 回调），
/// 无人工确认不落盘（原则 1.2-2）。与 --mcp 无头模式（stdio）并存。
/// </summary>
public sealed class McpPipeHost : IDisposable
{
    public const string PipeName = "gitui-mcp";

    private readonly LibGit2RepositoryService _repo;
    private readonly Func<string, Task<bool>> _approve;
    private readonly CancellationTokenSource _cts = new();
    private Task? _acceptLoop;
    private bool _disposed;

    public McpPipeHost(LibGit2RepositoryService repo, Func<string, Task<bool>> approve)
    {
        _repo = repo;
        _approve = approve;
    }

    /// <summary>启动接受循环（幂等）。仓库路径后续变化时重建宿主。</summary>
    public void Start(string workDir)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_acceptLoop is not null) return;

        _acceptLoop = Task.Run(() => AcceptLoopAsync(workDir, _cts.Token));
    }

    private async Task AcceptLoopAsync(string workDir, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var pipe = new NamedPipeServerStream(
                PipeName, PipeDirection.InOut, maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
            try
            {
                await pipe.WaitForConnectionAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                pipe.Dispose();
                return;
            }

            // 连接服务与接受循环并行：宿主同一时刻可被再次连接（排队到下一个实例）
            _ = ServeConnectionAsync(pipe, workDir, ct);
        }
    }

    private async Task ServeConnectionAsync(NamedPipeServerStream pipe, string workDir, CancellationToken ct)
    {
        try
        {
            var server = new GitterMcpServer(_repo, workDir, new McpServerOptions(WriteApproval: _approve));
            using var reader = new StreamReader(pipe, Encoding.UTF8);
            using var writer = new StreamWriter(pipe, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };

            while (!ct.IsCancellationRequested && pipe.IsConnected
                   && await reader.ReadLineAsync(ct).ConfigureAwait(false) is { } line)
            {
                var response = await server.HandleAsync(line).ConfigureAwait(false);
                if (response is not null)
                    await writer.WriteLineAsync(response).ConfigureAwait(false);
            }
        }
        catch (IOException)
        {
            // 客户端断开：正常结束
        }
        catch (OperationCanceledException) { /* 宿主停止 */ }
        finally
        {
            try { pipe.Dispose(); } catch { /* 已断开 */ }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();
        try { _acceptLoop?.Wait(TimeSpan.FromSeconds(2)); } catch { /* 后台任务取消 */ }
        _cts.Dispose();
    }
}
