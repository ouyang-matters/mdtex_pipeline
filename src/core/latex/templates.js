import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { paths, ensureDir } from '../paths.js';
import { cjkPreamble } from './cjk.js';

/**
 * PDF templates.
 *
 * A template is a LaTeX document skeleton with placeholders. MDTeX fills them
 * from the article metadata and the converted Markdown body:
 *
 *   {{DOCUMENTCLASS_OPTIONS}}  e.g. 11pt,a4paper
 *   {{FONT_SETUP}}             engine- and language-dependent font packages
 *   {{TITLE}}   {{AUTHOR}}   {{DATE}}
 *   {{TITLE_BLOCK}}            \maketitle, or empty when there is no title
 *   {{BODY}}                   the converted document body
 *
 * Built-ins are defined here so a fresh checkout always has working templates.
 * User templates live in ~/.local/share/publisher/pdf-templates/<name>.tex and
 * override built-ins with the same name.
 */

// Kept deliberately small: everything here ships with a base TeX Live install,
// so a minimal distribution can still produce a PDF. Templates that want more
// (titlesec, enumitem, ...) declare it themselves and list it in `packages`.
const BACKTICK = String.fromCharCode(96);

const COMMON_PACKAGES = String.raw`\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage{array}
\usepackage[normalem]{ulem}
\usepackage{listings}
\usepackage{xcolor}
\usepackage[hidelinks]{hyperref}

\lstset{
  basicstyle=\ttfamily\small,
  breaklines=true,
  breakatwhitespace=false,
  columns=flexible,
  keepspaces=true,
  showstringspaces=false,
  frame=single,
  rulecolor=\color{black!25},
  backgroundcolor=\color{black!3},
  xleftmargin=0.5em,
  xrightmargin=0.5em,
  aboveskip=1em,
  belowskip=1em,
  literate={~}{{\textasciitilde}}1
}

% Long display equations should shrink to the text width rather than run into
% the margin. This mirrors how the WeChat and preview renderers behave.
\makeatletter
\g@addto@macro\normalsize{%
  \setlength\abovedisplayskip{10pt plus 2pt minus 4pt}%
  \setlength\belowdisplayskip{10pt plus 2pt minus 4pt}%
}
\makeatother
\allowdisplaybreaks

% The listings package predates these languages, so teach it the ones writers
% actually use. Without this, a rust fence fails the build with
% "Couldn't load requested language".
\lstdefinelanguage{Rust}{
  morekeywords={as,async,await,break,const,continue,crate,dyn,else,enum,extern,false,fn,for,if,impl,in,let,loop,match,mod,move,mut,pub,ref,return,self,Self,static,struct,super,trait,true,type,unsafe,use,where,while},
  morekeywords=[2]{bool,char,f32,f64,i8,i16,i32,i64,i128,isize,str,u8,u16,u32,u64,u128,usize,String,Vec,Option,Result,Box},
  sensitive=true,
  morecomment=[l]{//}, morecomment=[s]{/*}{*/},
  morestring=[b]", morestring=[b]'
}
\lstdefinelanguage{Go}{
  morekeywords={break,case,chan,const,continue,default,defer,else,fallthrough,for,func,go,goto,if,import,interface,map,package,range,return,select,struct,switch,type,var},
  morekeywords=[2]{bool,byte,complex64,complex128,error,float32,float64,int,int8,int16,int32,int64,rune,string,uint,uint8,uint16,uint32,uint64,uintptr},
  sensitive=true,
  morecomment=[l]{//}, morecomment=[s]{/*}{*/},
  morestring=[b]", morestring=[b]${BACKTICK}
}
\lstdefinelanguage{JavaScript}{
  morekeywords={async,await,break,case,catch,class,const,continue,debugger,default,delete,do,else,export,extends,finally,for,from,function,get,if,import,in,instanceof,let,new,null,of,return,set,static,super,switch,this,throw,try,typeof,undefined,var,void,while,with,yield,true,false},
  sensitive=true,
  morecomment=[l]{//}, morecomment=[s]{/*}{*/},
  morestring=[b]", morestring=[b]', morestring=[b]${BACKTICK}
}
\lstdefinelanguage{TypeScript}{
  morekeywords={abstract,any,as,async,await,boolean,break,case,catch,class,const,constructor,continue,declare,default,delete,do,else,enum,export,extends,false,finally,for,from,function,get,if,implements,import,in,instanceof,interface,let,new,null,number,of,private,protected,public,readonly,return,set,static,string,super,switch,this,throw,true,try,type,typeof,undefined,var,void,while,yield},
  sensitive=true,
  morecomment=[l]{//}, morecomment=[s]{/*}{*/},
  morestring=[b]", morestring=[b]', morestring=[b]${BACKTICK}
}
\lstdefinelanguage{Kotlin}{
  morekeywords={as,break,by,class,companion,const,continue,data,do,else,enum,false,fun,for,if,import,in,init,interface,internal,is,it,lateinit,null,object,open,override,package,private,protected,public,return,sealed,super,suspend,this,throw,true,try,typealias,val,var,vararg,when,while},
  sensitive=true,
  morecomment=[l]{//}, morecomment=[s]{/*}{*/},
  morestring=[b]"
}
\lstdefinelanguage{Swift}{
  morekeywords={associatedtype,as,break,case,catch,class,continue,default,defer,deinit,do,else,enum,extension,fallthrough,false,fileprivate,for,func,guard,if,import,in,init,inout,internal,is,let,nil,open,operator,private,protocol,public,repeat,rethrows,return,self,Self,static,struct,subscript,super,switch,throw,throws,true,try,typealias,var,where,while},
  sensitive=true,
  morecomment=[l]{//}, morecomment=[s]{/*}{*/},
  morestring=[b]"
}
\lstdefinelanguage{JSON}{
  morestring=[b]"
}
\lstdefinelanguage{YAML}{
  morecomment=[l]{\#},
  morestring=[b]", morestring=[b]'
}
`;

const BUILTIN_TEMPLATES = {
  default: {
    id: 'default',
    label: 'Article',
    description: 'Clean single-column article. Good default for notes and blog-length pieces.',
    engine: 'xelatex',
    documentClassOptions: '11pt,a4paper',
    packages: ['amsmath', 'graphicx', 'listings', 'xcolor', 'hyperref', 'geometry', 'ulem'],
    source: String.raw`\documentclass[{{DOCUMENTCLASS_OPTIONS}}]{article}
\usepackage[a4paper,margin=2.5cm]{geometry}
${COMMON_PACKAGES}
{{FONT_SETUP}}

\title{{{TITLE}}}
\author{{{AUTHOR}}}
\date{{{DATE}}}

\begin{document}
{{TITLE_BLOCK}}
{{BODY}}
\end{document}
`,
  },

  academic: {
    id: 'academic',
    label: 'Academic Paper',
    description: 'Numbered sections, abstract support and tighter margins. Suits paper drafts.',
    engine: 'xelatex',
    documentClassOptions: '11pt,a4paper',
    packages: ['amsmath', 'graphicx', 'listings', 'xcolor', 'hyperref', 'geometry', 'ulem', 'abstract', 'titlesec'],
    source: String.raw`\documentclass[{{DOCUMENTCLASS_OPTIONS}}]{article}
\usepackage[a4paper,margin=2.2cm]{geometry}
${COMMON_PACKAGES}
\usepackage{abstract}
\usepackage{titlesec}
\titleformat{\section}{\normalfont\large\bfseries}{\thesection}{1em}{}
\titleformat{\subsection}{\normalfont\normalsize\bfseries}{\thesubsection}{1em}{}
{{FONT_SETUP}}

\theoremstyle{plain}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{corollary}[theorem]{Corollary}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newtheorem{remark}[theorem]{Remark}

\title{{{TITLE}}}
\author{{{AUTHOR}}}
\date{{{DATE}}}

\begin{document}
{{TITLE_BLOCK}}
{{BODY}}
\end{document}
`,
  },

  notes: {
    id: 'notes',
    label: 'Compact Notes',
    description: 'Dense layout with small margins. Best for lecture notes and derivations.',
    engine: 'xelatex',
    documentClassOptions: '10pt,a4paper',
    packages: ['amsmath', 'graphicx', 'listings', 'xcolor', 'hyperref', 'geometry', 'ulem', 'parskip', 'enumitem'],
    source: String.raw`\documentclass[{{DOCUMENTCLASS_OPTIONS}}]{article}
\usepackage[a4paper,margin=1.8cm]{geometry}
${COMMON_PACKAGES}
\usepackage{parskip}
\usepackage{enumitem}
\setlist{itemsep=2pt,topsep=4pt,parsep=0pt}
{{FONT_SETUP}}

\title{{{TITLE}}}
\author{{{AUTHOR}}}
\date{{{DATE}}}

\begin{document}
{{TITLE_BLOCK}}
{{BODY}}
\end{document}
`,
  },
};

export const DEFAULT_TEMPLATE = 'default';

/** Directory holding user-authored templates. */
export function userTemplatesDir() {
  return join(paths.dataDir, 'pdf-templates');
}

/**
 * List every available template (built-in plus user).
 * User templates with a built-in's name take priority.
 */
export function listPdfTemplates() {
  const map = new Map();

  for (const t of Object.values(BUILTIN_TEMPLATES)) {
    map.set(t.id, { id: t.id, label: t.label, description: t.description, engine: t.engine, packages: t.packages || [], source: 'builtin' });
  }

  const dir = userTemplatesDir();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter(f => f.endsWith('.tex'))) {
      const id = basename(file, '.tex');
      const existing = map.get(id);
      map.set(id, {
        id,
        label: existing ? `${existing.label} (customised)` : id,
        description: existing?.description || 'User template',
        engine: existing?.engine || 'xelatex',
        source: 'user',
        overridesBuiltin: Boolean(existing),
        path: join(dir, file),
      });
    }
  }

  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Load a template's raw skeleton. Throws when the name is unknown. */
export function loadPdfTemplate(id = DEFAULT_TEMPLATE) {
  const userPath = join(userTemplatesDir(), `${id}.tex`);
  if (existsSync(userPath)) {
    const builtin = BUILTIN_TEMPLATES[id];
    return {
      id,
      source: readFileSync(userPath, 'utf-8'),
      engine: builtin?.engine || 'xelatex',
      documentClassOptions: builtin?.documentClassOptions || '11pt,a4paper',
      packages: builtin?.packages || [],
      origin: 'user',
      path: userPath,
    };
  }

  const builtin = BUILTIN_TEMPLATES[id];
  if (!builtin) throw new Error(`Unknown PDF template: ${id}`);
  return { ...builtin, origin: 'builtin' };
}

/** Write a built-in template into the user directory so it can be customised. */
export function ejectPdfTemplate(id, targetName = null) {
  const template = loadPdfTemplate(id);
  const dir = ensureDir(userTemplatesDir());
  const name = targetName || id;
  const target = join(dir, `${name}.tex`);
  writeFileSync(target, template.source, 'utf-8');
  return target;
}

/**
 * Font/language setup for the chosen engine.
 *
 * XeLaTeX and LuaLaTeX read system fonts directly; pdfLaTeX cannot, and cannot
 * typeset CJK at all. `cjkAvailable` comes from a kpsewhich probe so a machine
 * without ctex degrades to a warning instead of a failed build.
 */
export function buildFontSetup({ engine, language = 'en', cjk = null }) {
  const lines = [];
  const warnings = [];

  if (engine === 'pdflatex') {
    lines.push('\\usepackage[T1]{fontenc}');
    lines.push('\\usepackage[utf8]{inputenc}');
    lines.push('\\usepackage{lmodern}');
    if (cjk?.needed) warnings.push(cjk.blocker || 'pdfLaTeX cannot typeset CJK text.');
    return { setup: lines.join('\n'), warnings };
  }

  // XeLaTeX / LuaLaTeX
  lines.push('\\usepackage{fontspec}');
  lines.push('\\defaultfontfeatures{Ligatures=TeX}');

  // The CJK decision was made before the build, against the fonts and packages
  // this machine actually has. See core/latex/cjk.js — the font is the part
  // that matters, and it is checked rather than assumed.
  if (cjk?.needed) {
    const preamble = cjkPreamble(cjk);
    if (preamble) lines.push(preamble);
    warnings.push(...cjk.warnings);
    if (cjk.blocker) warnings.push(cjk.blocker);
  }

  return { setup: lines.join('\n'), warnings };
}

/**
 * Fill a template. Placeholders that have no value collapse to nothing rather
 * than leaving `{{...}}` in the output.
 */
export function renderPdfTemplate(template, values) {
  const filled = {
    DOCUMENTCLASS_OPTIONS: values.documentClassOptions ?? template.documentClassOptions ?? '11pt,a4paper',
    FONT_SETUP: values.fontSetup ?? '',
    TITLE: values.title ?? '',
    AUTHOR: values.author ?? '',
    DATE: values.date ?? '',
    TITLE_BLOCK: values.titleBlock ?? '',
    BODY: values.body ?? '',
  };

  return template.source.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => filled[key] ?? '');
}
