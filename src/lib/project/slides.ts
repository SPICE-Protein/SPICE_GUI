// Presenter mode slide parser — an iA-Presenter-flavored adaptation of the
// journal's markdown. Supported syntax:
//   - `---` horizontal rules and `#`/`##` headings start a new slide.
//   - Paragraphs, lists (incl. nested + task lists), tables (with :-- --: :-:
//     alignment), fenced code, images → ON-SLIDE content.
//   - Blockquotes `> ...` → SPEAKER NOTES (invisible to the audience).
//   - Inline: **bold** *italic* ~~strike~~ ==highlight== `code` [link](url)
//     superscript ^2^ / ^(a+b)^ subscript ~2~ reference links [t][ref].
//   - `[^id]` footnote refs + `[^id]: note` defs (numbered per slide, grouped
//     at the slide bottom); inline form `[^free text note]` also works.
//   - Lines starting with `//` are presenter-only comments (never rendered).
// Pure, dependency-free. HTML is escaped first, then reassembled, so slide
// content can never inject markup outside the tags we generate here.

export interface Slide {
  level: 0 | 1 | 2;
  title: string | null;
  bodyHtml: string;
  notesHtml: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface SlideCtx {
  fnRefs: { id: string | null; note: string }[];
  refLinks: Map<string, string>;
  fnDefs: Map<string, string>;
}

function renderInline(text: string, ctx?: SlideCtx): string {
  let t = escapeHtml(text);
  // Code spans first; stash their content behind placeholders so later
  // emphasis regexes can't eat characters inside them.
  const codes: string[] = [];
  t = t.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);

    return '@C@' + (codes.length - 1) + '@C@';
  });
  // Images before links (same syntax + leading !)
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => `<img src="${src}" alt="${alt}" />`);
  // Reference links [text][ref] and [ref][] (defs collected at block level)
  if (ctx) {
    t = t.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (_m, label, refRaw) => {
      const key = (refRaw || label).toLowerCase();
      const href = ctx.refLinks.get(key);
      if (!href) return _m;
      return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
    });
  }
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  t = t.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  // superscript: ^(a+b)^ or ^2^ (no spaces in the simple form)
  t = t.replace(/\^(\((?:[^()]|\([^()]*\))*\)|[^\s^()]+)\^/g, (_m, c) => `<sup>${c.startsWith('(') ? c.slice(1, -1) : c}</sup>`);
  // subscript: ~x~ (single tildes only — ~~ already consumed by <del>)
  t = t.replace(/(^|[^~])~([^~\s]+)~/g, '$1<sub>$2</sub>');
  // footnotes: [^id] (def elsewhere) or [^inline note text]
  if (ctx) {
    t = t.replace(/\[\^([^\]]+)\]/g, (_m, inner) => {
      const idx = ctx.fnRefs.length;
      const asDef = inner.trim();
      // an id is short & bracket-free & was defined; otherwise treat as note text
      ctx.fnRefs.push({ id: /^[A-Za-z0-9_.-]{1,24}$/.test(asDef) ? asDef.toLowerCase() : null, note: asDef });
      return `@@FN${idx}@@`;
    });
  }
  t = t.replace(/@C@(\d+)@C@/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  return t;
}

interface Draft {
  level: 0 | 1 | 2;
  title: string | null;
  body: string[];
  notes: string[];
  ctx: SlideCtx;
}

const HR_RE = /^\s*(---+|\*\*\*+|___+)\s*$/;
const H_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
const OL_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const FENCE_RE = /^\s*```/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}.*$/;
const FN_DEF_RE = /^\s*\[\^([^\]]+)\]:\s*(.*)$/;
const REF_DEF_RE = /^\s*\[([^\]^]+)\]:\s*(\S+)(\s+["'(].*)?$/;
const COMMENT_RE = /^\s*\/\//; // presenter-only comment line

function listIndent(line: string): number {
  const m = line.match(/^[\t ]*/);
  if (!m) return 0;
  return m[0].replace(/\t/g, '    ').length;
}

/** Recursively render a run of consecutive list lines (indent-nested). */
interface LiItem {
  indent: number;
  ordered: boolean;
  content: string;
}
function renderListRun(items: LiItem[], ctx: SlideCtx): string {
  let pos = 0;
  const parseLevel = (indent: number): string => {
    const ordered = items[pos].ordered;
    let lis = '';
    while (pos < items.length && items[pos].indent >= indent) {
      if (items[pos].indent > indent) {
        const sub = parseLevel(items[pos].indent);
        // attach nested list inside the previous <li>
        lis = lis.replace(/<\/li>$/, sub + '</li>');
      } else {
        const task = items[pos].content.match(/^\[( |x|X)\]\s*(.*)$/);
        const checked = task ? task[1].toLowerCase() === 'x' : false;
        const inner = task
          ? `<span class="sp-task">${checked ? '☑' : '☐'}</span> ${renderInline(task[2], ctx)}`
          : renderInline(items[pos].content, ctx);
        lis += `<li${task ? ' class="sp-li-task"' : ''}>${inner}</li>`;
        pos++;
      }
    }
    return `<${ordered ? 'ol' : 'ul'} class="sp-list">${lis}</${ordered ? 'ol' : 'ul'}>`;
  };
  return parseLevel(items[0].indent);
}

function flushParagraph(buf: string[], out: string[], pClass: string, ctx: SlideCtx) {
  if (!buf.length) return;
  out.push(`<p class="${pClass}">${renderInline(buf.join(' '), ctx)}</p>`);
  buf.length = 0;
}

/** Number footnote refs in order of first use and emit the grouped block. */
function finalizeFootnotes(d: Draft): string {
  let body = d.body.join('\n');
  const numbered = new Map<string, number>(); // id → n (repeat refs reuse n)
  const entries: { n: number; note: string }[] = [];
  let counter = 0;
  body = body.replace(/@@FN(\d+)@@/g, (_m, i) => {
    const ref = d.ctx.fnRefs[Number(i)];
    let n: number;
    if (ref.id) {
      const existing = numbered.get(ref.id);
      if (existing !== undefined) {
        n = existing;
      } else {
        n = ++counter;
        numbered.set(ref.id, n);
        entries.push({ n, note: d.ctx.fnDefs.get(ref.id) ?? '' });
      }
    } else {
      // inline form [^free text] — its text IS the note
      n = ++counter;
      entries.push({ n, note: ref.note });
    }
    return `<sup class="sp-fnm">${n}</sup>`;
  });
  d.body.length = 0;
  if (body) d.body.push(body);
  if (!entries.length) return '';
  return (
    '<div class="sp-fnbox">' +
    entries
      .slice()
      .sort((a, b) => a.n - b.n)
      .map(e => `<div class="sp-fn"><sup>${e.n}</sup> ${renderInline(e.note, d.ctx)}</div>`)
      .join('') +
    '</div>'
  );
}

export function parseSlides(md: string): Slide[] {
  const lines = (md || '').replace(/\r\n?/g, '\n').split('\n');
  const drafts: Draft[] = [];

  // Document-level pre-pass: footnote defs and reference links may appear
  // AFTER their use (standard markdown practice) — collect first.
  const docRefLinks = new Map<string, string>();
  const docFnDefs = new Map<string, string>();
  {
    let fence = false;
    for (const line of lines) {
      if (FENCE_RE.test(line)) {
        fence = !fence;
        continue;
      }
      if (fence) continue;
      const fnd = line.match(FN_DEF_RE);
      if (fnd) {
        docFnDefs.set(fnd[1].trim().toLowerCase(), fnd[2].trim());
        continue;
      }
      const rfd = line.match(REF_DEF_RE);
      if (rfd) docRefLinks.set(rfd[1].trim().toLowerCase(), rfd[2].trim());
    }
  }

  const newDraft = (): Draft => ({
    level: 0,
    title: null,
    body: [],
    notes: [],
    ctx: { fnRefs: [], refLinks: docRefLinks, fnDefs: docFnDefs }
  });
  let cur = newDraft();
  let para: string[] = [];
  let notePara: string[] = [];
  let inFence = false;
  let fenceBuf: string[] = [];

  const closeSlide = () => {
    flushParagraph(para, cur.body, 'sp-p', cur.ctx);
    flushParagraph(notePara, cur.notes, 'sp-np', cur.ctx);
    const fnBlock = finalizeFootnotes(cur);
    if (fnBlock) cur.body.push(fnBlock);
    if (cur.title || cur.body.length || cur.notes.length) drafts.push(cur);
    cur = newDraft();
    para = [];
    notePara = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inFence) {
      if (FENCE_RE.test(line)) {
        cur.body.push(`<pre class="sp-pre"><code>${escapeHtml(fenceBuf.join('\n'))}</code></pre>`);
        fenceBuf = [];
        inFence = false;
      } else {
        fenceBuf.push(line);
      }
      continue;
    }
    // presenter-only comment line
    if (COMMENT_RE.test(line)) continue;
    // footnote definition [^id]: note
    const fnd = line.match(FN_DEF_RE);
    if (fnd) {
      cur.ctx.fnDefs.set(fnd[1].trim().toLowerCase(), fnd[2].trim());
      continue;
    }
    // reference link definition [id]: url
    const rfd = line.match(REF_DEF_RE);
    if (rfd) {
      cur.ctx.refLinks.set(rfd[1].trim().toLowerCase(), rfd[2].trim());
      continue;
    }
    if (FENCE_RE.test(line)) {
      flushParagraph(para, cur.body, 'sp-p', cur.ctx);
      inFence = true;
      continue;
    }
    if (HR_RE.test(line)) {
      closeSlide();
      continue;
    }
    const h = line.match(H_RE);
    if (h) {
      const depth = h[1].length;
      if (depth === 1 || depth === 2) {
        closeSlide();
        cur.level = depth as 1 | 2;
        cur.title = h[2].trim();
      } else {
        flushParagraph(para, cur.body, 'sp-p', cur.ctx);
        flushParagraph(notePara, cur.notes, 'sp-np', cur.ctx);
        cur.body.push(`<h3 class="sp-h3">${renderInline(h[2].trim(), cur.ctx)}</h3>`);
      }
      continue;
    }
    const q = line.match(QUOTE_RE);
    if (q) {
      flushParagraph(para, cur.body, 'sp-p', cur.ctx);
      if (!q[1].trim()) flushParagraph(notePara, cur.notes, 'sp-np', cur.ctx);
      else notePara.push(q[1].trim());
      continue;
    }
    const ul = line.match(UL_RE);
    const ol = ul ? null : line.match(OL_RE);
    if (ul || ol) {
      flushParagraph(para, cur.body, 'sp-p', cur.ctx);
      // collect the whole consecutive list run (incl. nested indents)
      const items: LiItem[] = [];
      let j = i;
      for (; j < lines.length; j++) {
        const mu = lines[j].match(UL_RE);
        const mo = mu ? null : lines[j].match(OL_RE);
        if (!mu && !mo) break;
        const indent = listIndent(mu ? mu[0] : mo![0]);
        items.push({ indent, ordered: !!mo, content: (mu ?? mo)![2].trim() });
      }
      cur.body.push(renderListRun(items, cur.ctx));
      i = j - 1;
      continue;
    }
    // table: current line has a pipe and the next line is a separator row
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushParagraph(para, cur.body, 'sp-p', cur.ctx);
      // alignment from separator row: :-- left, --: right, :-: center
      const sepCells = lines[i + 1].replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
      const aligns = sepCells.map(c => {
        const s = c.trim();
        if (s.startsWith(':') && s.endsWith(':')) return 'center';
        if (s.endsWith(':')) return 'right';
        return 'left';
      });
      const parseRow = (row: string, tag: string) =>
        row
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((c, ci) => `<${tag} class="sp-${tag}" style="text-align:${aligns[ci] ?? 'left'}">${renderInline(c.trim(), cur.ctx)}</${tag}>`)
          .join('');
      let html = `<table class="sp-table"><thead><tr>${parseRow(line, 'th')}</tr></thead><tbody>`;
      i += 2;
      for (; i < lines.length && lines[i].includes('|'); i++) {
        html += `<tr>${parseRow(lines[i], 'td')}</tr>`;
      }
      html += '</tbody></table>';
      cur.body.push(html);
      i -= 1;
      continue;
    }
    if (!line.trim()) {
      flushParagraph(para, cur.body, 'sp-p', cur.ctx);
      flushParagraph(notePara, cur.notes, 'sp-np', cur.ctx);
      continue;
    }
    para.push(line.trim());
  }
  if (inFence && fenceBuf.length) {
    cur.body.push(`<pre class="sp-pre"><code>${escapeHtml(fenceBuf.join('\n'))}</code></pre>`);
  }
  closeSlide();

  return drafts
    .filter(d => d.title || d.body.length || d.notes.length)
    .map(d => ({
      level: d.level,
      title: d.title,
      bodyHtml: d.body.join('\n'),
      notesHtml: d.notes.join('\n')
    }));
}

export function hasSlides(md: string): boolean {
  const s = parseSlides(md);
  return s.some(sl => sl.title || sl.bodyHtml);
}
