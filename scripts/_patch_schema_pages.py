import io

p = 'app/src/services/extensions/schema.ts'
s = io.open(p, encoding='utf-8').read()

# 1) PageContribution 接口定义（若缺）
if 'export interface PageContribution {' not in s:
    old = 'export interface EmptyHintContribution {'
    assert s.count(old) == 1, "i1 %d" % s.count(old)
    new = '''export interface PageContribution {
  id: string;
  title: string;
  /** 渲染层入口（经典 script，相对包目录；经 window.GITTER_UI 注册） */
  entry: string;
  icon: string | null;
}

export interface EmptyHintContribution {'''
    s = s.replace(old, new)

# 2) zod pages 段（若缺）
if 'pages: z\n' not in s:
    old = '      emptyHints: z\n'
    assert s.count(old) == 1, "z1 %d" % s.count(old)
    new = '''      pages: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1),
            entry: z.string().min(1),
            icon: z.string().nullish(),
          }),
        )
        .optional(),
      emptyHints: z
    '''
    new = new.rstrip()
    new = new[:-len('      emptyHints: z')].rstrip() + '\n' + '      emptyHints: z'
    # 直接构造：pages 段插在 emptyHints zod 之前
    s = s.replace(old, '''      pages: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1),
            entry: z.string().min(1),
            icon: z.string().nullish(),
          }),
        )
        .optional(),
''' + old, 1)

# 3) v2 map（若缺）
old = '          emptyHints: (c.emptyHints ?? []).map((h) => ({ slot: h.slot, text: h.text })),'
if s.count(old) == 1:
    new = old + '''
          pages: (c.pages ?? []).map((pg) => ({
            id: pg.id, title: pg.title, entry: pg.entry, icon: pg.icon ?? null,
          })),'''
    s = s.replace(old, new)
elif s.count(old) == 0:
    raise AssertionError("v2 emptyHints map missing — 状态异常")

# 4) v1 兼容空数组（若缺）
old = '        emptyHints: [],'
cnt = s.count(old)
if cnt >= 1:
    # 只补 v1 分支那处（v1 分支特征：后随 harnesses: []）
    old2 = '        emptyHints: [],\n        harnesses: [],'
    if s.count(old2) == 1:
        s = s.replace(old2, '        emptyHints: [],\n        pages: [],\n        harnesses: [],')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('schema pages 修复 ✓')
