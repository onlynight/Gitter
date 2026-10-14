/**
 * monaco 内部 esm 深路径的窄类型面（库包 monacoLib.ts 专用）：
 * esm 产物不随发 .d.ts，tsc 需要 declare module 兜住导入；只声明用到的成员，
 * 库升级后成员变化会在赋值/调用处显式报错，不会静默 any。
 *
 * TokenizationRegistry（vs/editor/common/languages.js 模块级单例）与 editor.main
 * 引用的是同一实例——basic-languages / aura / hat 的 Monarch 分词器经它惰性解析。
 */
declare module "monaco-editor/esm/vs/editor/common/languages.js" {
  /** MonarchTokenizer.tokenize 的字符串 token 面（未进 ITokenizationSupport 公有类型，
   *  仅 Monarch 系分词器实现；结果 tokens 为相邻去重后的 Token 序列——偏移属性是
   *  offset（monaco languages.Token），type 可能带语言后缀（如 "keyword.ts"）。） */
  interface IStringTokenizeResult {
    tokens: { offset: number; type: string; language?: string }[];
    endState: unknown;
  }
  export interface ITokenizationSupportLike {
    getInitialState(): unknown;
    /** 字符串 token 面：Monarch 实现；TextMate/tree-sitter 等实现只有 tokenizeEncoded。 */
    tokenize?(line: string, hasEOL: boolean, state: unknown): IStringTokenizeResult | null;
  }
  export const TokenizationRegistry: {
    /** 未注册语言返回 null；Monarch 工厂语言首次调用触发惰性编译。 */
    getOrCreate(languageId: string): Promise<ITokenizationSupportLike | null>;
  };
}
