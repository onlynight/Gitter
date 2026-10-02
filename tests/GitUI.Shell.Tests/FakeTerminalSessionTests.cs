using System.Text;
using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>FakeTerminalSession 替身语义：事件可编程驱动、写入可断言、Dispose 幂等。</summary>
public sealed class FakeTerminalSessionTests
{
    [Fact]
    public void Start_IncrementsCountAndSetsRunning()
    {
        using var fake = new FakeTerminalSession();

        Assert.False(fake.IsRunning);
        fake.Start();

        Assert.True(fake.IsRunning);
        Assert.Equal(1, fake.StartCount);
    }

    [Fact]
    public void Start_Twice_Throws()
    {
        using var fake = new FakeTerminalSession();
        fake.Start();

        Assert.Throws<InvalidOperationException>(fake.Start);
    }

    [Fact]
    public void Write_RecordsBytesForAssertions()
    {
        using var fake = new FakeTerminalSession();
        fake.Write("cd /tmp"u8);
        fake.Write("\n"u8);

        Assert.Equal("cd /tmp\n", fake.GetWrittenText());
    }

    [Fact]
    public void Write_EchoInput_ReplaysToOutputReady()
    {
        using var fake = new FakeTerminalSession { EchoInput = true };
        var received = new List<string>();
        fake.OutputReady += data => received.Add(Encoding.UTF8.GetString(data.Span));

        fake.Write("ls\n"u8);

        var text = Assert.Single(received);
        Assert.Equal("ls\n", text);
    }

    [Fact]
    public void Write_NoEcho_DoesNotRaiseOutput()
    {
        using var fake = new FakeTerminalSession();
        var raised = false;
        fake.OutputReady += _ => raised = true;

        fake.Write("ls\n"u8);

        Assert.False(raised);
    }

    [Fact]
    public void SimulateOutput_DrivesOutputReady()
    {
        using var fake = new FakeTerminalSession();
        string? received = null;
        fake.OutputReady += data => received = Encoding.UTF8.GetString(data.Span);

        fake.SimulateOutput("hello");

        Assert.Equal("hello", received);
    }

    [Fact]
    public void SimulateExit_StopsSessionAndRaisesExited()
    {
        using var fake = new FakeTerminalSession();
        fake.Start();
        int? code = null;
        fake.Exited += exit => code = exit;

        fake.SimulateExit(42);

        Assert.Equal(42, code);
        Assert.False(fake.IsRunning);
    }

    [Fact]
    public void Resize_LastCallWins()
    {
        using var fake = new FakeTerminalSession();
        fake.Resize(80, 24);
        fake.Resize(100, 30);

        Assert.Equal((100, 30), fake.LastResize);
    }

    [Fact]
    public void Dispose_IsIdempotent()
    {
        var fake = new FakeTerminalSession();
        fake.Start();

        fake.Dispose();
        fake.Dispose();

        Assert.Equal(2, fake.DisposeCount);
        Assert.False(fake.IsRunning);
    }

    [Fact]
    public void Title_RoundTrips()
    {
        using var fake = new FakeTerminalSession { Title = "MINGW64:/c/repo" };

        Assert.Equal("MINGW64:/c/repo", fake.Title);
    }
}
