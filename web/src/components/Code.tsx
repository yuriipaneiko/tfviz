import { Fragment, type ReactNode } from "react";

type Tok = { t: string; c?: string };

const KEYWORDS = /^(resource|data|module|variable|output|locals|provider|terraform|dynamic|content|lifecycle|moved|import|removed|check|backend|required_providers|for|in|if|for_each|count|depends_on)\b/;

const COLORS: Record<string, string> = {
  comment: "text-faint italic",
  string: "text-[#16a34a] dark:text-[#86efac]",
  number: "text-[#d97706] dark:text-[#fbbf24]",
  bool: "text-[#d97706] dark:text-[#fbbf24]",
  keyword: "text-[#7c3aed] dark:text-[#c4b5fd] font-semibold",
  attr: "text-[#0369a1] dark:text-[#7dd3fc]",
  ref: "text-[#db2777] dark:text-[#f9a8d4]",
  interp: "text-[#db2777] dark:text-[#f9a8d4]",
  punct: "text-muted",
  func: "text-[#ca8a04] dark:text-[#fde68a]",
};

function tokenizeLine(line: string, state: { heredoc?: string; block?: boolean }): Tok[] {
  const out: Tok[] = [];
  if (state.heredoc) {
    if (line.trim() === state.heredoc) {
      state.heredoc = undefined;
      return [{ t: line, c: "keyword" }];
    }
    return [{ t: line, c: "string" }];
  }
  let i = 0;
  const push = (t: string, c?: string) => t && out.push({ t, c });
  if (state.block) {
    const end = line.indexOf("*/");
    if (end < 0) return [{ t: line, c: "comment" }];
    push(line.slice(0, end + 2), "comment");
    i = end + 2;
    state.block = false;
  }
  const attrMatch = line.slice(i).match(/^(\s*)([\w-]+)(\s*=(?!=))/);
  if (attrMatch && i === 0) {
    push(attrMatch[1]);
    push(attrMatch[2], "attr");
    push(attrMatch[3], "punct");
    i = attrMatch[0].length;
  } else if (i === 0) {
    const kw = line.match(/^(\s*)([\w-]+)(?=\s*("|\{))/);
    if (kw) {
      push(kw[1]);
      push(kw[2], "keyword");
      i = kw[0].length;
    }
  }
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpMatchArray | null;
    if (rest.startsWith("#") || rest.startsWith("//")) {
      push(rest, "comment");
      break;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2);
      if (end < 0) {
        push(rest, "comment");
        state.block = true;
        break;
      }
      push(rest.slice(0, end + 2), "comment");
      i += end + 2;
      continue;
    }
    if ((m = rest.match(/^<<-?(\w+)/))) {
      push(m[0], "keyword");
      state.heredoc = m[1];
      i += m[0].length;
      continue;
    }
    if (rest[0] === '"') {
      let j = 1;
      let depth = 0;
      while (j < rest.length) {
        if (rest[j] === "\\") j += 2;
        else if (rest.startsWith("${", j)) {
          depth++;
          j += 2;
        } else if (rest[j] === "}" && depth > 0) {
          depth--;
          j++;
        } else if (rest[j] === '"' && depth === 0) {
          j++;
          break;
        } else j++;
      }
      const s = rest.slice(0, j);
      const parts = s.split(/(\$\{[^}]*\})/g);
      for (const p of parts) push(p, p.startsWith("${") ? "interp" : "string");
      i += j;
      continue;
    }
    if ((m = rest.match(/^(true|false|null)\b/))) {
      push(m[0], "bool");
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^\d+(\.\d+)?\b/))) {
      push(m[0], "number");
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^(var|local|module|data|each|count|path|self)\.[\w.\-[\]*"]+/)) || (m = rest.match(/^[a-z][a-z0-9]*_[\w]+\.[\w]+(\[[^\]]*\])?(\.[\w*]+)*/))) {
      push(m[0], "ref");
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^([\w]+)(?=\()/))) {
      push(m[0], "func");
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(KEYWORDS)) && /^\s/.test(line.slice(i - 1, i) || " ")) {
      push(m[0], "keyword");
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^[{}[\]()=,:?]+/))) {
      push(m[0], "punct");
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^[^"#{}[\]()=,:?/<]+/))) {
      push(m[0]);
      i += m[0].length;
      continue;
    }
    push(rest[0]);
    i++;
  }
  return out;
}

export function HclCode({ code, startLine = 1, highlight }: { code: string; startLine?: number; highlight?: [number, number] }) {
  const state = {};
  const lines = code.replace(/\s+$/, "").split("\n");
  return (
    <div className="code-scroll overflow-auto rounded-xl border border-line bg-panel-2 font-mono text-[12px] leading-[1.6]">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => {
            const n = startLine + idx;
            const hl = highlight && n >= highlight[0] && n <= highlight[1];
            return (
              <tr key={idx} className={hl ? "bg-delete/10" : undefined}>
                <td className="w-10 select-none border-r border-line px-2 text-right align-top text-faint">{n}</td>
                <td className="whitespace-pre px-3">
                  {tokenizeLine(line, state).map((t, k) => (
                    <span key={k} className={t.c ? COLORS[t.c] : undefined}>
                      {t.t}
                    </span>
                  ))}
                  {line === "" && "\u00a0"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InlineHcl({ code }: { code: string }) {
  const state = {};
  const lines = code.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && "\n"}
          {tokenizeLine(line, state).map((t, k) => (
            <span key={k} className={t.c ? COLORS[t.c] : undefined}>
              {t.t}
            </span>
          ))}
        </Fragment>
      ))}
    </>
  );
}

const ANSI_FG: Record<number, string> = {
  30: "#6b7280", 31: "#ef4444", 32: "#22c55e", 33: "#eab308", 34: "#3b82f6", 35: "#a855f7", 36: "#06b6d4", 37: "#d1d5db",
  90: "#9ca3af", 91: "#f87171", 92: "#4ade80", 93: "#facc15", 94: "#60a5fa", 95: "#c084fc", 96: "#22d3ee", 97: "#f9fafb",
};

export function Ansi({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\x1b\[([\d;]*)m/g;
  let last = 0;
  let style: { color?: string; bold?: boolean; dim?: boolean; underline?: boolean } = {};
  let m: RegExpExecArray | null;
  let k = 0;
  const flush = (s: string) => {
    if (!s) return;
    parts.push(
      <span
        key={k++}
        style={{
          color: style.color,
          fontWeight: style.bold ? 600 : undefined,
          opacity: style.dim ? 0.7 : undefined,
          textDecoration: style.underline ? "underline" : undefined,
        }}
      >
        {s}
      </span>,
    );
  };
  while ((m = re.exec(text))) {
    flush(text.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] ? m[1].split(";").map(Number) : [0];
    for (const c of codes) {
      if (c === 0) style = {};
      else if (c === 1) style = { ...style, bold: true };
      else if (c === 2) style = { ...style, dim: true };
      else if (c === 4) style = { ...style, underline: true };
      else if (c === 22) style = { ...style, bold: false, dim: false };
      else if (c === 39) style = { ...style, color: undefined };
      else if (ANSI_FG[c]) style = { ...style, color: ANSI_FG[c] };
    }
  }
  flush(text.slice(last));
  return <>{parts}</>;
}
