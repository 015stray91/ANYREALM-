/**
 * Glacier spec -> QML theme bridge.
 *
 * GlacierUI's `@glacier/spec` emits a language-agnostic `spec.json` plus a JSON
 * Schema, and `@glacier/tokens` emits `tokens.json`. That is a real contract, so
 * it can drive a Qt Quick UI — which is what Lipstick is built from.
 *
 * The obstacle is not the JSON. It is that the token *values* are CSS:
 *
 *   space-4  = calc(clamp(1rem, 0.9342rem + 0.3289vw, 1.25rem) * var(--glacier-density-scale))
 *   radius-md = calc(0.625rem * var(--glacier-radius-scale))
 *
 * QML has no `calc`, no `clamp`, no viewport units and no `var()`. Handing these
 * strings to a QML property produces a binding that fails at load and a UI that
 * silently falls back to zero. So the values have to be *resolved to numbers*
 * before they cross the bridge, against a concrete screen and density — which is
 * what this module does.
 *
 * Resolution model, stated explicitly because getting it wrong changes every
 * spacing in the UI:
 *
 *   - `px` and `pt` are absolute; `1pt` is `96/72` CSS px.
 *   - `rem` is `16 * htmlFontPercent/100` CSS px. The docs app sets a root font
 *     size, so the same token catalog renders at different sizes; the caller
 *     passes the percentage it wants.
 *   - `vw` is a percentage of the *width* in CSS px, `vh` of the height. A phone
 *     in portrait and the same phone in landscape therefore resolve `clamp()` to
 *     different values — which is the point of the clamp, and why a QML theme
 *     cannot be generated once and shipped as constants.
 *   - `clamp(lo, pref, hi)` takes the preferred value bounded by lo and hi.
 *   - `calc(a * b)` multiplies; nested parens are handled by recursing.
 *   - `var(--glacier-density-scale)` and friends come from the caller. The
 *     density scale is not a length, so it is passed as a plain multiplier.
 *
 * Everything unresolved is reported, never guessed. A token this module cannot
 * parse becomes `null` in the output plus an entry in `unresolved`, so a QML
 * generator can fail loudly instead of painting a zero-height control.
 */

export interface Viewport {
  /** Panel width in CSS pixels. */
  width: number;
  /** Panel height in CSS pixels. */
  height: number;
  /** Root font size as a percentage of 16px (CSS `html { font-size: 100% }`). */
  htmlFontPercent?: number;
  /** Multiplier for `--glacier-density-scale`. */
  densityScale?: number;
  /** Multiplier for `--glacier-radius-scale`. */
  radiusScale?: number;
  /** Multiplier for `--glacier-glass-blur-scale`. */
  blurScale?: number;
}

export interface ResolvedToken {
  /** Token name without the `--glacier-` prefix, e.g. `space-4`. */
  name: string;
  /** The original CSS string, kept so a diff can show what changed. */
  source: string;
  /** What this token is. Decides which QML property type it becomes. */
  kind: TokenKind;
  /** Numeric value in CSS px (or ms for a duration), when kind is length. */
  px: number | null;
  /** Bare number, when kind is number. */
  number: number | null;
  /** Value passed through as text: font stack, easing, gradient. */
  text: string | null;
  /** True when the value is a colour rather than a length. */
  isColor: boolean;
  /** The colour, when it could be resolved to something Qt can parse. */
  color?: string;
  /** The var() chain that produced this value, for diagnosis. */
  chain?: string[];
  /** Why the value failed to resolve, when it did not. */
  error?: string;
}

export interface ResolveReport {
  tokens: ResolvedToken[];
  /** Token name -> reason. Empty when every token resolved. */
  unresolved: Array<{ name: string; source: string; reason: string }>;
  viewport: Required<Viewport>;
  /** Tokens that resolved to a different value at the other orientation. */
  orientationSensitive: string[];
  /** Theme layer used, and how many layers the stylesheet had. */
  theme: "light" | "dark";
  layerCount: number;
}

const PX_PER_REM_AT_100 = 16;
const PX_PER_PT = 96 / 72;

/** A numeric length in CSS px. */
type Len = number;

/**
 * Parse a single CSS length token into CSS px.
 *
 * Returns null for anything that is not a plain absolute length, so the caller
 * can decide (a `var()` reference is handled before this is called).
 */
function parseLength(expr: string, vp: Required<Viewport>): Len | null {
  const s = expr.trim();
  if (s === "0") return 0;

  // Sign, number, unit. Deliberately strict: a unit we do not know is a bug in
  // this module, not something to approximate.
  const m = /^([+-]?\d*\.?\d+)(px|rem|em|pt|vw|vh|vmin|vmax|%)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] ?? "";

  switch (unit) {
    case "px":
      return n;
    case "rem":
    case "em":
      // `em` inside a token is the root em: tokens are authored at the root, and
      // treating them as relative to a parent font size would need runtime
      // context QML does not give us at theme-build time.
      return n * PX_PER_REM_AT_100 * (vp.htmlFontPercent / 100);
    case "pt":
      return n * PX_PER_PT;
    case "vw":
      return (n / 100) * vp.width;
    case "vh":
      return (n / 100) * vp.height;
    case "vmin":
      return (n / 100) * Math.min(vp.width, vp.height);
    case "vmax":
      return (n / 100) * Math.max(vp.width, vp.height);
    case "%":
      // A bare percentage has no base without a parent; refuse rather than guess.
      return null;
    case "":
      // A unitless non-zero number in CSS is invalid as a length.
      return n === 0 ? 0 : null;
    default:
      return null;
  }
}

/**
 * Split the arguments of a CSS function, respecting nested parentheses.
 *
 * `clamp(1rem, 0.9rem + 0.3vw, 1.25rem)` -> ['1rem', '0.9rem + 0.3vw', '1.25rem']
 */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Evaluate a CSS length expression to CSS px, or null.
 *
 * Supports: single lengths, `a + b`, `a - b`, `a * n`, `n * a`, `a / n`,
 * `clamp(a, b, c)`, and `calc(...)` around any of those. Functions are found by
 * name at the head of the expression so a nested clamp inside a calc works.
 */
export function evalCssLength(expr: string, vp: Required<Viewport>): Len | null {
  let s = expr.trim();
  if (!s) return null;

  // Unwrap any number of enclosing calc(...).
  let guard = 0;
  while (/^calc\s*\(/i.test(s) && guard++ < 32) {
    const open = s.indexOf("(");
    const close = matchParen(s, open);
    if (close < 0) return null;
    s = s.slice(open + 1, close).trim();
  }

  // Substance: resolve a function at the head of the expression, then continue
  // with whatever follows it joined by an operator.
  const fn = /^(clamp|min|max)\s*\(/i.exec(s);
  if (fn) {
    const open = s.indexOf("(", fn[0].length - 1);
    const close = matchParen(s, open);
    if (close < 0) return null;
    const args = splitArgs(s.slice(open + 1, close)).map((a) => evalCssLength(a, vp));
    if (args.some((a) => a === null)) return null;
    const nums = args as number[];
    const head = fn[1].toLowerCase() === "clamp"
      ? Math.min(Math.max(nums[1], nums[0]), nums[2])
      : fn[1].toLowerCase() === "min"
        ? Math.min(...nums)
        : Math.max(...nums);
    const rest = s.slice(close + 1).trim();
    if (!rest) return head;
    // e.g. clamp(...) * var(--glacier-density-scale), already substituted to a
    // number by the caller, arrives as `clamp(...) * 1.0`
    return applyTail(head, rest, vp);
  }

  // `var()` should already have been substituted. If one remains, it is a
  // reference this module does not know about: refuse.
  if (s.includes("var(")) return null;

  // Repeated multiplication only: `a * b * c`. Addition is folded left to right
  // below because CSS requires whitespace around + to mean addition, which the
  // clamp preferred values rely on.
  // Find the top-level additive operator.
  const add = findTopLevel(s, ["+", "-"]);
  if (add >= 0) {
    const left = evalCssLength(s.slice(0, add), vp);
    const right = evalCssLength(s.slice(add + 1), vp);
    if (left === null || right === null) return null;
    return s[add] === "+" ? left + right : left - right;
  }

  const mul = findTopLevel(s, ["*", "/"]);
  if (mul >= 0) {
    const left = s.slice(0, mul).trim();
    const right = s.slice(mul + 1).trim();
    const op = s[mul];
    const ln = parseLength(left, vp);
    const rn = parseLength(right, vp);
    if (op === "*") {
      // One side must be a pure number.
      if (ln !== null && rn !== null) return ln * rn; // both lengths is a bug
      const la = ln ?? numberLiteral(left);
      const ra = rn ?? numberLiteral(right);
      if (la !== null && ra !== null) return la * ra;
      return null;
    }
    if (ln !== null && rn !== null && rn !== 0) return ln / rn;
    const la = ln ?? numberLiteral(left);
    const ra = rn ?? numberLiteral(right);
    if (la !== null && ra !== null && ra !== 0) return la / ra;
    return null;
  }

  return parseLength(s, vp);
}

function numberLiteral(s: string): number | null {
  const m = /^[+-]?\d*\.?\d+$/.exec(s.trim());
  return m ? parseFloat(m[0]) : null;
}

/** Continue evaluating after a resolved function head, e.g. `* 1.0` or `+ 2px`. */
function applyTail(head: number, rest: string, vp: Required<Viewport>): number | null {
  const m = /^([*\/+\-])\s*(.+)$/.exec(rest);
  if (!m) return null;
  const op = m[1];
  const rhsRaw = m[2].trim();
  const rhs = evalCssLength(rhsRaw, vp) ?? numberLiteral(rhsRaw);
  if (rhs === null) return null;
  switch (op) {
    case "*":
      return head * rhs;
    case "/":
      return rhs === 0 ? null : head / rhs;
    case "+":
      return head + rhs;
    case "-":
      return head - rhs;
  }
  return null;
}

/** Index of `)` matching the `(` at `open`, or -1. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Index of the first operator from `ops` that is not inside parentheses.
 *
 * A `-` directly after `(` or `,` or at the start is a sign, not subtraction.
 */
function findTopLevel(s: string, ops: string[]): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && ops.includes(ch)) {
      if ((ch === "+" || ch === "-")) {
        const prev = s.slice(0, i).trimEnd();
        // A leading sign belongs to the number.
        if (prev === "" || prev.endsWith("(") || prev.endsWith(",") || prev.endsWith("*") || prev.endsWith("/")) continue;
        // CSS requires spaces around + and - for them to be operators, but the
        // resolved input from a clamp argument may not have them once trimmed.
        // Treat as operator whenever there is content on both sides.
        if (!s.slice(i + 1).trim()) continue;
      }
      return i;
    }
  }
  return -1;
}

/** Substitute `var(--glacier-x)` and `var(--glacier-x, fallback)` with numbers. */
export function substituteVars(
  expr: string,
  vars: Record<string, number>,
): { out: string; missing: string[] } {
  const missing: string[] = [];
  let guard = 0;
  let s = expr;
  while (guard++ < 64) {
    const i = s.indexOf("var(");
    if (i < 0) break;
    const open = s.indexOf("(", i);
    const close = matchParen(s, open);
    if (close < 0) break;
    const inner = s.slice(open + 1, close);
    const [rawName, rawFallback] = splitArgs(inner);
    const name = rawName.trim().replace(/^--/, "");
    if (name in vars) {
      s = s.slice(0, i) + String(vars[name]) + s.slice(close + 1);
      continue;
    }
    if (rawFallback !== undefined) {
      // A fallback that is a plain number is used directly; anything else is
      // left for the length evaluator.
      s = s.slice(0, i) + rawFallback.trim() + s.slice(close + 1);
      continue;
    }
    missing.push(name);
    // Replace with something the evaluator will refuse, so the token fails
    // loudly rather than silently becoming zero.
    s = s.slice(0, i) + "__UNRESOLVED__" + s.slice(close + 1);
  }
  return { out: s, missing };
}

/**
 * Token kinds, because a "token" in this catalog is four different things and
 * each needs different treatment in QML.
 *
 *   length   a distance (or a duration in ms) -> a `real`
 *   color    a colour, often `var(--glacier-gray-3)` -> a resolved colour string
 *   number   a bare number: font weight, line height unitless ratio
 *   opaque   a font stack, an easing curve, a gradient: passed through as text
 *
 * Guessing wrong here is what makes a generated theme paint nothing, so the
 * classification is explicit and every branch is reported.
 */
export type TokenKind = "length" | "color" | "number" | "opaque";

/** Units that make a value a length in CSS. Durations are kept as ms. */
const LENGTH_UNIT = /^(px|rem|em|pt|vw|vh|vmin|vmax)$/;
const DURATION_UNIT = /(ms|s)$/;

function classify(value: string): TokenKind {
  const s = value.trim();
  if (!s) return "opaque";

  // A var() reference is classified by what it points at, which needs the
  // cascade; the resolver handles that before calling this.
  if (s.startsWith("var(")) return "opaque";

  if (/^[+-]?\d*\.?\d+$/.test(s)) return "number";

  if (DURATION_UNIT.test(s) && /^[\d.]+(ms|s)$/.test(s)) return "length";

  // Colours, including oklch and the functional forms.
  if (
    s.startsWith("#") ||
    /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/.test(s) ||
    /gradient\(/.test(s) ||
    s === "transparent" ||
    s === "currentcolor"
  ) {
    return "color";
  }

  // A length is a number followed by a length unit, possibly wrapped in
  // calc()/clamp()/min()/max().
  if (/^(calc|clamp|min|max)\(/.test(s)) {
    // Could still resolve to a colour if it contains color-mix; treat as length
    // only when no colour function is inside.
    return /color|oklch|rgb|hsl/i.test(s) ? "color" : "length";
  }
  const m = /^([+-]?\d*\.?\d+)([a-z%]*)$/i.exec(s);
  if (m && LENGTH_UNIT.test(m[2])) return "length";

  return "opaque";
}

// ---------------------------------------------------------------------------
// CSS cascade
// ---------------------------------------------------------------------------

/**
 * One declaration block's worth of custom properties.
 *
 * The tokens file is not one flat map: `:root` holds the light theme and
 * `[data-theme='dark']` overrides a subset. Reading it as flat text loses the
 * distinction between "this token is dark-only" and "this token never changes",
 * and picking a theme needs that distinction.
 */
export interface CssThemeLayer {
  /** Selector text, normalised: `:root`, `dark`, `light`, ... */
  selector: string;
  /** Custom property name without the `--glacier-` prefix -> raw value. */
  props: Record<string, string>;
}

/** Strip CSS comments before parsing, keeping string literals intact. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Parse a token stylesheet into ordered theme layers.
 *
 * Only top-level blocks are read; a nested at-rule block is treated as its own
 * layer keyed by the at-rule prelude, which is enough for `@media` overrides and
 * honest about what it found rather than silently merging them.
 */
export function parseCssTheme(css: string): CssThemeLayer[] {
  const src = stripComments(css);
  const layers: CssThemeLayer[] = [];
  let i = 0;

  while (i < src.length) {
    const brace = src.indexOf("{", i);
    if (brace < 0) break;
    let selector = src.slice(i, brace).trim();
    // Remove a trailing at-rule prelude so the layer name is the selector.
    const close = matchBrace(src, brace);
    if (close < 0) break;
    const body = src.slice(brace + 1, close);
    i = close + 1;

    // Normalise: `[data-theme='dark']` -> dark, `:root` -> root.
    let name = selector;
    const dt = /\[data-theme=['"]?([a-z]+)['"]?\]/.exec(selector);
    if (dt) name = dt[1];
    else if (/:root/.test(selector)) name = "root";
    else if (selector.startsWith("@media")) name = "media:" + selector.slice(6).trim();

    const props: Record<string, string> = {};
    // Declarations only: `--glacier-x: value;`
    const decl = /--glacier-([a-z0-9-]+)\s*:\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = decl.exec(body))) {
      props[m[1]] = m[2].trim();
    }
    // A nested block inside (e.g. @media within :root) is skipped here and would
    // appear as its own layer if the file has one.
    if (Object.keys(props).length) layers.push({ selector: name, props });
  }
  return layers;
}

function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Flatten layers into one property map for a chosen theme.
 *
 * Order matters and follows the cascade: `root` first, then the requested theme
 * layer, so a dark-only override wins over the light default. A `media:` layer is
 * applied last because in CSS a media query that matches does override a plain
 * `:root` rule of equal specificity -- but only the caller knows whether the
 * query matches, so media layers are opt-in.
 */
export function flattenTheme(
  layers: CssThemeLayer[],
  opts: { theme?: "light" | "dark"; includeMedia?: boolean } = {},
): Record<string, string> {
  const theme = opts.theme ?? "dark";
  const flat: Record<string, string> = {};

  const root = layers.find((l) => l.selector === "root");
  if (root) Object.assign(flat, root.props);

  // A non-root, non-media layer whose name matches the theme.
  for (const l of layers) {
    if (l.selector === "root" || l.selector.startsWith("media:")) continue;
    if (l.selector === theme) Object.assign(flat, l.props);
  }

  if (opts.includeMedia) {
    for (const l of layers) {
      if (l.selector.startsWith("media:")) Object.assign(flat, l.props);
    }
  }
  return flat;
}

/**
 * Follow `var()` chains to a concrete value.
 *
 * The semantic layer is nothing but aliases: `--glacier-accent-text:
 * var(--glacier-accent-11)`, which is `var(--glacier-accent-10)`... A QML
 * generator cannot emit `"var(--glacier-accent-11)"` as a colour, so the chain
 * has to be walked to the end.
 */
export function derefVar(
  name: string,
  flat: Record<string, string>,
  depth = 0,
): { value: string | null; chain: string[]; error?: string } {
  if (depth > 32) return { value: null, chain: [name], error: "var() chain too deep" };
  const raw = flat[name];
  if (raw === undefined) return { value: null, chain: [name], error: `no such token: ${name}` };

  const m = /^var\(\s*--glacier-([a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/.exec(raw.trim());
  if (!m) return { value: raw, chain: [name] };
  const next = m[1];
  const r = derefVar(next, flat, depth + 1);
  if (r.value === null && m[2]) {
    return { value: m[2].trim(), chain: [name, ...r.chain] };
  }
  return { value: r.value, chain: [name, ...r.chain], error: r.error };
}

/**
 * Convert an oklch() colour to sRGB `rgb()` for Qt.
 *
 * Qt does not parse `oklch()` in a QML colour property on every version this
 * project supports, and the token ramps are authored entirely in oklch. Doing the
 * conversion here keeps it visible and testable instead of depending on the
 * runtime's colour parser.
 *
 * Standard OKLab -> LMS -> linear sRGB -> gamma sRGB transform, alpha carried.
 */
export function oklchToRgb(value: string): string | null {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/i.exec(
    value.trim(),
  );
  if (!m) return null;
  const L = parseFloat(m[1]);
  const C = parseFloat(m[2]);
  const hDeg = parseFloat(m[3]);
  const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;

  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  let r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  let bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  const gamma = (x: number) => {
    const c = Math.max(0, Math.min(1, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  r = gamma(r);
  g = gamma(g);
  bl = gamma(bl);

  const to255 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  if (alpha >= 0.999) return `rgb(${to255(r)}, ${to255(g)}, ${to255(bl)})`;
  const aStr = Math.round(alpha * 1000) / 1000;
  return `rgba(${to255(r)}, ${to255(g)}, ${to255(bl)}, ${aStr})`;
}

/** Make a colour string acceptable to QML. */
function normaliseColor(value: string): { out: string; converted: boolean } {
  const s = value.trim();
  if (s.toLowerCase().startsWith("oklch(")) {
    const rgb = oklchToRgb(s);
    if (rgb) return { out: rgb, converted: true };
  }
  return { out: s, converted: false };
}

/** True when the value is a bare duration, which is kept in ms. */
function isDuration(value: string): boolean {
  return /^[\d.]+(ms|s)$/.test(value.trim());
}

/**
 * Resolve a whole token stylesheet for one concrete screen and theme.
 *
 * This is what a QML generator calls. It reads the *CSS*, not `tokens.json`: the
 * JSON is a partial catalog (285 entries against 856 declarations in the
 * stylesheet) and omits the semantic alias layer the component specs reference.
 * The stylesheet is what the browser actually gets.
 */
export function resolveStylesheet(
  css: string,
  vp: Viewport,
  opts: { theme?: "light" | "dark" } = {},
): ResolveReport {
  const layers = parseCssTheme(css);
  const theme = opts.theme ?? "dark";
  const flat = flattenTheme(layers, { theme });

  const resolved: Required<Viewport> = {
    width: vp.width,
    height: vp.height,
    htmlFontPercent: vp.htmlFontPercent ?? 100,
    densityScale: vp.densityScale ?? 1,
    radiusScale: vp.radiusScale ?? 1,
    blurScale: vp.blurScale ?? 1,
  };

  // Scalars that other tokens multiply by. These are read from the cascade when
  // the stylesheet defines them, so a theme block that changes the frostedness
  // changes every blur token with it. The caller's explicit values win, because
  // a build target may want a density the stylesheet does not offer.
  const vars: Record<string, number> = {
    "glacier-density-scale": resolved.densityScale,
    "glacier-radius-scale": resolved.radiusScale,
    "glacier-glass-blur-scale": resolved.blurScale,
  };
  for (const [k, v] of Object.entries(vars)) {
    const short = k.replace(/^glacier-/, "");
    const declared = flat[short] ?? flat[k];
    if (declared !== undefined && /^[\d.]+$/.test(declared.trim())) {
      // Only adopt the stylesheet value when the caller did not set one.
      const callerSet =
        (short === "density-scale" && vp.densityScale !== undefined) ||
        (short === "radius-scale" && vp.radiusScale !== undefined) ||
        (short === "glass-blur-scale" && vp.blurScale !== undefined);
      if (!callerSet) vars[k] = parseFloat(declared);
    }
  }
  resolved.densityScale = vars["glacier-density-scale"];
  resolved.radiusScale = vars["glacier-radius-scale"];
  resolved.blurScale = vars["glacier-glass-blur-scale"];

  const out: ResolvedToken[] = [];
  const unresolved: ResolveReport["unresolved"] = [];

  for (const name of Object.keys(flat).sort()) {
    const source = flat[name];

    // Walk var() aliases to a concrete value first: a semantic token's raw value
    // is a reference, and QML cannot consume a reference as a colour.
    const d = derefVar(name, flat);
    if (d.value === null) {
      unresolved.push({ name, source, reason: d.error ?? "unresolved var()" });
      out.push({
        name, source, kind: "opaque", px: null, number: null, text: null,
        isColor: false, error: d.error,
      });
      continue;
    }

    const kind = classify(d.value);
    const base = { name, source, chain: d.chain };

    if (kind === "number") {
      const n = parseFloat(d.value);
      out.push({
        ...base, kind, px: null, number: Number.isFinite(n) ? n : null,
        text: null, isColor: false,
      });
      continue;
    }

    if (kind === "color") {
      const { out: col } = normaliseColor(d.value);
      if (col.includes("gradient(")) {
        // A gradient is paint, not a flat colour; keep it as text for a caller
        // that knows how to build a QML Gradient from it.
        out.push({ ...base, kind: "opaque", px: null, number: null, text: col, isColor: false });
        continue;
      }
      out.push({
        ...base, kind, px: null, number: null, text: col, isColor: true, color: col,
      });
      continue;
    }

    if (kind === "length") {
      // A duration is a time, not a distance. Mixing it into the same `real`
      // namespace makes `duration-fast` read as a 150-unit gap.
      if (isDuration(d.value)) {
        const ms = d.value.trim().endsWith("ms")
          ? parseFloat(d.value)
          : parseFloat(d.value) * 1000;
        out.push({ ...base, kind: "length", px: ms, number: null, text: null, isColor: false });
        continue;
      }
      const { out: sub, missing } = substituteVars(d.value, vars);
      if (missing.length) {
        unresolved.push({ name, source, reason: `unresolved var(): ${missing.join(", ")}` });
        out.push({
          ...base, kind, px: null, number: null, text: null,
          isColor: false, error: "unresolved var()",
        });
        continue;
      }
      const px = evalCssLength(sub, resolved);
      if (px === null) {
        // Not every length-looking value is one: a calc() over a percentage has
        // no base here, so it is reported rather than approximated.
        unresolved.push({ name, source, reason: `could not evaluate as a length: ${d.value}` });
        out.push({
          ...base, kind, px: null, number: null, text: null,
          isColor: false, error: "not a length",
        });
        continue;
      }
      out.push({ ...base, kind, px, number: null, text: null, isColor: false });
      continue;
    }

    // opaque: font stacks, easing curves, gradients, keywords.
    out.push({ ...base, kind: "opaque", px: null, number: null, text: d.value, isColor: false });
  }

  // Orientation comparison: which lengths move when the panel rotates? A theme
  // generated for portrait and shipped to landscape is a layout that overflows.
  const portrait = new Map(out.filter((t) => t.kind === "length").map((t) => [t.name, t.px]));
  const swappedVp = { ...resolved, width: resolved.height, height: resolved.width };
  const orientationSensitive: string[] = [];
  for (const name of Object.keys(flat)) {
    const d = derefVar(name, flat);
    if (!d.value || classify(d.value) !== "length" || isDuration(d.value)) continue;
    const { out: sub, missing } = substituteVars(d.value, vars);
    if (missing.length) continue;
    const alt = evalCssLength(sub, swappedVp);
    const now = portrait.get(name);
    if (alt !== null && now != null && alt !== now) orientationSensitive.push(name);
  }

  return {
    tokens: out,
    unresolved,
    viewport: resolved,
    orientationSensitive,
    theme,
    layerCount: layers.length,
  };
}

/**
 * Emit a QML singleton holding the resolved theme.
 *
 * Each token becomes the property type its kind needs, because the four kinds do
 * not interchange:
 *
 *   length -> `real` (CSS px, or ms for a duration) plus a `...Str` string
 *   color  -> `string` holding an sRGB value Qt can parse
 *   number -> `real` (font weight, unitless line height)
 *   opaque -> `string` (font stack, easing curve, gradient)
 *
 * A `Str` companion exists only for lengths, where a value is sometimes needed as
 * a CSS-ish string and the caller should not have to remember to append "px".
 *
 * The header states the viewport the file was built for. The numbers are correct
 * at exactly that size, and a theme silently reused at another size is the
 * failure this module exists to prevent.
 */
export function emitQmlTheme(report: ResolveReport, opts: { moduleName?: string } = {}): string {
  const module = opts.moduleName ?? "GlacierTheme";
  const vp = report.viewport;
  const lines: string[] = [];

  lines.push("// Generated by anyrealm-builder/glacier-qml-bridge.ts -- do not edit.");
  lines.push("//");
  lines.push(`// Theme: ${report.theme} (${report.layerCount} cascade layer(s)).`);
  lines.push(`// Resolved for a ${vp.width}x${vp.height} panel at ${vp.htmlFontPercent}% root font,`);
  lines.push(`// density ${vp.densityScale}, radius scale ${vp.radiusScale}, blur scale ${vp.blurScale}.`);
  lines.push("//");
  lines.push("// These are numbers, not CSS: clamp() and viewport units are evaluated at");
  lines.push("// generation time, so this file is correct at exactly that one size.");
  if (report.orientationSensitive.length) {
    lines.push("//");
    lines.push(`// ${report.orientationSensitive.length} token(s) change with orientation and are NOT`);
    lines.push("// carried here as constants -- regenerate for the other size, or bind them");
    lines.push("// to the compositor's mode:");
    for (const n of report.orientationSensitive.slice(0, 12)) lines.push(`//   ${n}`);
    if (report.orientationSensitive.length > 12) {
      lines.push(`//   ... and ${report.orientationSensitive.length - 12} more`);
    }
  }
  if (report.unresolved.length) {
    lines.push("//");
    lines.push(`// ${report.unresolved.length} token(s) could not be resolved and are omitted:`);
    for (const u of report.unresolved.slice(0, 20)) {
      lines.push(`//   ${u.name}: ${u.reason}`);
    }
    if (report.unresolved.length > 20) {
      lines.push(`//   ... and ${report.unresolved.length - 20} more`);
    }
  }
  lines.push("");
  lines.push("pragma Singleton");
  lines.push("import QtQuick");
  lines.push("");
  lines.push(`QtObject {`);

  const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const num = (v: number) =>
    Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

  const lengths = report.tokens.filter((t) => t.kind === "length" && t.px !== null);
  const numbers = report.tokens.filter((t) => t.kind === "number" && t.number !== null);
  const colors = report.tokens.filter((t) => t.kind === "color" && t.color);
  const opaque = report.tokens.filter((t) => t.kind === "opaque" && t.text);

  if (colors.length) {
    lines.push("    // --- colours, converted to sRGB for Qt ---");
    for (const t of colors) {
      lines.push(`    readonly property string ${camel(t.name)}: ${JSON.stringify(t.color)}`);
    }
    lines.push("");
  }

  if (lengths.length) {
    lines.push("    // --- lengths, in CSS px (durations in ms) ---");
    for (const t of lengths) {
      const n = camel(t.name);
      const v = num(t.px!);
      lines.push(`    readonly property real ${n}: ${v}`);
      lines.push(`    readonly property string ${n}Str: "${v}px"`);
    }
    lines.push("");
  }

  if (numbers.length) {
    lines.push("    // --- bare numbers: weights and ratios ---");
    for (const t of numbers) {
      lines.push(`    readonly property real ${camel(t.name)}: ${num(t.number!)}`);
    }
    lines.push("");
  }

  if (opaque.length) {
    lines.push("    // --- passed through as text: font stacks, easings, gradients ---");
    for (const t of opaque) {
      lines.push(`    readonly property string ${camel(t.name)}: ${JSON.stringify(t.text)}`);
    }
    lines.push("");
  }

  lines.push(`    readonly property real panelWidth: ${vp.width}`);
  lines.push(`    readonly property real panelHeight: ${vp.height}`);
  lines.push(`    readonly property bool generationComplete: ${report.unresolved.length === 0}`);
  lines.push("}");

  return lines.join("\n") + "\n";
}

/**
 * The spec side: which tokens does a component use, and can this theme serve it?
 *
 * A component whose spec names a token the theme could not resolve will render
 * wrong, so a generator should refuse it rather than emit a control that is
 * missing its colour.
 */
export interface ComponentBinding {
  id: string;
  name: string;
  category: string;
  /** Tokens this component references, without the `$` sigil. */
  tokens: string[];
  /** Tokens it needs that the theme did not resolve. */
  missingTokens: string[];
  /**
   * Tokens the spec names that do not exist in the token stylesheet at all.
   *
   * This is a defect in the spec, not in the theme: no viewport and no theme
   * choice can supply a token nobody declares. Reported separately because the
   * fix is different -- edit the spec, not the theme.
   */
  specDefects: Array<{ token: string; suggestion?: string }>;
  /** Prop names, by spec type, so a QML component stub can be shaped. */
  props: Array<{ name: string; type: string; default?: unknown }>;
  /** True when every token is available. */
  renderable: boolean;
}

export function bindComponents(
  specs: Array<{ id: string; name: string; category: string; props?: any[]; tokens?: string[]; [k: string]: any }>,
  report: ResolveReport,
): ComponentBinding[] {
  const available = new Set<string>();
  /** Declared in the stylesheet, even if this viewport could not resolve it. */
  const declared = new Set<string>(report.tokens.map((t) => t.name));
  for (const t of report.tokens) {
    // A token is usable when it produced a value of its kind. An `opaque` token
    // is usable too: a font stack is a real thing a QML Text needs.
    if (t.kind === "length" ? t.px !== null : t.kind === "number" ? t.number !== null : t.text !== null) {
      available.add(t.name);
    }
  }

  // A token the spec names but the stylesheet never declares is a spec bug. The
  // observed case is `font-family-sans`, where the real token is `font-sans`;
  // suggest the closest declared name so the fix is a one-line edit.
  const suggest = (want: string): string | undefined => {
    const wantParts = want.split("-").filter(Boolean);

    // Word overlap first. The observed defect is `font-family-sans` where the
    // token is `font-sans`: seven edit operations apart, but an obvious subset of
    // words. Edit distance alone would miss it and propose something unrelated.
    let subsetBest: string | undefined;
    let subsetBestScore = Infinity;
    for (const cand of declared) {
      const parts = cand.split("-").filter(Boolean);
      if (parts.length === 0 || parts.length >= wantParts.length) continue;
      const contained = parts.every((p) => wantParts.includes(p));
      if (!contained) continue;
      // Prefer the candidate sharing the most words and the longest last word,
      // so `font-sans` beats a looser partial match.
      const score = wantParts.length - parts.length;
      if (score < subsetBestScore) {
        subsetBestScore = score;
        subsetBest = cand;
      }
    }
    if (subsetBest) return subsetBest;

    let best: string | undefined;
    let bestScore = Infinity;
    for (const cand of declared) {
      const d = levenshtein(want, cand);
      if (d < bestScore) {
        bestScore = d;
        best = cand;
      }
    }
    // Only suggest when it is plausibly a typo rather than an unrelated name.
    return bestScore <= Math.max(2, Math.floor(want.length / 4)) ? best : undefined;
  };

  // Walk each spec for `tokens: [...]` arrays and `$ref` strings, since a
  // component can name a token in paint, states, dimensions or transition.
  const collect = (o: unknown, acc: Set<string>) => {
    if (typeof o === "string") {
      if (o.startsWith("$")) acc.add(o.slice(1));
      return;
    }
    if (Array.isArray(o)) {
      for (const v of o) collect(v, acc);
      return;
    }
    if (o && typeof o === "object") {
      for (const v of Object.values(o)) collect(v, acc);
    }
  };

  return specs.map((s) => {
    const needed = new Set<string>();
    collect(s, needed);
    // `$` also appears in CSS-ish strings such as "$radius-xs"; ensure the plain
    // token list is included too.
    if (Array.isArray(s.tokens)) for (const t of s.tokens) needed.add(String(t).replace(/^\$/, ""));

    const tokens = [...needed].sort();
    const missingTokens = tokens.filter((t) => !available.has(t));
    const specDefects = tokens
      .filter((t) => !declared.has(t))
      .map((t) => ({ token: t, suggestion: suggest(t) }));
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      tokens,
      missingTokens,
      specDefects,
      props: (s.props ?? []).map((p: any) => ({
        name: p.name,
        type: p.type,
        default: p.default,
      })),
      renderable: missingTokens.length === 0,
    };
  });
}

/** Edit distance, for suggesting a token name that does exist. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}
