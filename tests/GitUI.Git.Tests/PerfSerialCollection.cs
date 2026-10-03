using Xunit;

namespace GitUI.Git.Tests;

/// <summary>性能测试专用串行 collection：避免与单元测试并行争抢 CPU 导致基准抖动。</summary>
[CollectionDefinition("PerfSerial", DisableParallelization = true)]
public sealed class PerfSerialCollectionDefinition { }
