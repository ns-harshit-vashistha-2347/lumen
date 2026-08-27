// Tiny language-agnostic syntax highlighter.
// Produces HTML strings that use the .tok-* classes in globals.css so it
// automatically re-themes when the user swaps monokai/matrix/light.
//
// Not competitive with shiki/prismjs — but zero-dep, ~2KB, and covers the
// languages we see in RAG/code answers well enough (js/ts/python/go/rust/
// java/c/sql/json/bash/generic).

const KW: Record<string, string> = {
  js: "await|async|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|true|false|null|undefined|as",
  ts: "await|async|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|interface|let|new|of|return|super|switch|this|throw|try|type|typeof|var|void|while|with|yield|true|false|null|undefined|as|readonly|public|private|protected|enum|namespace|abstract|implements|is|keyof|infer|declare|module",
  py: "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None",
  go: "break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|true|false|nil",
  rust: "as|break|const|continue|crate|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while|async|await|dyn",
  java: "abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|true|false|null",
  c: "auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|true|false|NULL",
  sql: "SELECT|FROM|WHERE|GROUP|BY|ORDER|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|JOIN|INNER|LEFT|RIGHT|OUTER|ON|AS|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|EXISTS|UNION|ALL|DISTINCT|HAVING|CASE|WHEN|THEN|ELSE|END|RETURNING|WITH",
  bash: "if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|export|local|readonly|declare|source|alias|unset|echo|printf|read|cd|pwd|ls|cp|mv|rm|mkdir|rmdir|touch|cat|grep|awk|sed|find|xargs|test|true|false",
};

const langAliases: Record<string, string> = {
  javascript: "js", jsx: "js", ts: "ts", typescript: "ts", tsx: "ts",
  python: "py", py: "py",
  golang: "go", go: "go",
  rs: "rust", rust: "rust",
  java: "java",
  c: "c", cpp: "c", "c++": "c", h: "c", hpp: "c",
  sql: "sql", psql: "sql", mysql: "sql",
  sh: "bash", bash: "bash", shell: "bash", zsh: "bash",
};

const HTML_ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESC[c] || c);
}

interface Rule {
  re: RegExp;
  cls: string;
}

function rulesFor(lang: string): Rule[] {
  const kw = KW[lang];
  const isSQL = lang === "sql";

  const rules: Rule[] = [
    // multi-line comments — /* ... */ (js/ts/c/rust/go/java) or """ ... """ (py)
    { re: /\/\*[\s\S]*?\*\//g, cls: "tok-comment" },
    ...(lang === "py"
      ? [{ re: /("""[\s\S]*?"""|'''[\s\S]*?''')/g, cls: "tok-str" }]
      : []),
    // line comments
    {
      re: lang === "py" || lang === "bash" ? /#.*$/gm
        : lang === "sql" ? /--.*$/gm
        : /\/\/.*$/gm,
      cls: "tok-comment",
    },
    // strings (double, single, backtick)
    { re: /"(?:\\.|[^"\\])*"/g, cls: "tok-str" },
    { re: /'(?:\\.|[^'\\])*'/g, cls: "tok-str" },
    { re: /`(?:\\.|[^`\\])*`/g, cls: "tok-str" },
    // numbers
    { re: /\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, cls: "tok-num" },
    // decorators / annotations
    ...(lang === "py" ? [{ re: /@[A-Za-z_][\w.]*/g, cls: "tok-const" }] : []),
    ...(lang === "java" ? [{ re: /@[A-Z][\w]*/g, cls: "tok-const" }] : []),
    // keywords
    ...(kw
      ? [{ re: new RegExp(`\\b(?:${kw})\\b`, isSQL ? "g" : "g"), cls: "tok-kw" }]
      : []),
    // types (Capitalized identifiers) — common convention for js/ts/py/rust/java
    ...(lang !== "sql" && lang !== "bash"
      ? [{ re: /\b[A-Z][A-Za-z0-9_]*\b/g, cls: "tok-type" }]
      : []),
    // function calls  identifier(
    { re: /\b([a-z_][\w]*)(?=\s*\()/g, cls: "tok-fn" },
  ];
  return rules;
}

// Non-overlapping tokenize by scanning left-to-right; each region is either
// a captured token or literal text.
export function highlight(code: string, langRaw?: string): string {
  const lang = langAliases[(langRaw || "").toLowerCase()] || "";
  if (!lang) return esc(code);

  const rules = rulesFor(lang);
  const N = code.length;
  // spans: [start, end, className][]
  const spans: [number, number, string][] = [];

  for (const { re, cls } of rules) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) {
        re.lastIndex++;
        continue;
      }
      // Skip if overlaps any earlier span
      const clash = spans.some(([s, e]) => start < e && end > s);
      if (!clash) spans.push([start, end, cls]);
    }
  }

  spans.sort((a, b) => a[0] - b[0]);

  let out = "";
  let cursor = 0;
  for (const [s, e, cls] of spans) {
    if (s < cursor) continue;
    if (s > cursor) out += esc(code.slice(cursor, s));
    out += `<span class="${cls}">${esc(code.slice(s, e))}</span>`;
    cursor = e;
  }
  if (cursor < N) out += esc(code.slice(cursor));
  return out;
}

export function detectLangFromClassName(className?: string): string | undefined {
  if (!className) return undefined;
  const m = className.match(/language-([\w+-]+)/);
  return m ? m[1] : undefined;
}
