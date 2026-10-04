// 示例脚本高亮器：.todo 清单（GitUI 脚本插件参考实现）
gitui.syntax.register({
  id: "sample.jstodo",
  language: "todo",
  extensions: [".todo"],
  tokenizeLine: function (line, state) {
    var spans = [];

    // 完成行（x 开头）整行降灰
    if (/^x\s/i.test(line)) {
      spans.push({ start: 0, length: line.length, style: "comment" });
      return { spans: spans, state: state };
    }

    // [ ] / [x] 标记
    var m = /^\[[ xX]\]\s?/.exec(line);
    if (m) spans.push({ start: m.index, length: m[0].length, style: "keyword" });

    // 优先级 !high / !low
    m = /!(high|low)\b/.exec(line);
    if (m) spans.push({ start: m.index, length: m[0].length, style: m[1] === "high" ? "string" : "comment" });

    // 日期
    m = /\b\d{4}-\d{2}-\d{2}\b/.exec(line);
    if (m) spans.push({ start: m.index, length: m[0].length, style: "number" });

    return { spans: spans, state: state };
  }
});
