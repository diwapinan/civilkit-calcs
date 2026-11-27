//! Dimension figures: a ```dim fence draws dimension lines and labels over a picture, with the
//! labels (and, if wanted, the geometry) taken from the sheet's quantities.
//!
//! ````text
//! ```dim
//! image beam.png 800x400 width 600
//! dim  60,330 740,330 offset 40 | {L}
//! vdim 740,330 740,90 offset -40 | h = {h -> mm}
//! text 400,200 | w = {w -> kN/m}
//! ```
//! ````
//!
//! The figure is written as Calcpad text lines holding HTML and SVG: the picture, an SVG layer
//! in the picture's own pixel coordinates, and the labels as HTML placed over it. A value in a
//! label or a coordinate is a Calcpad expression inside the text line, so the engine fills it in
//! where the fence stands, and the figure follows the calculation. `#val ... #end val` and
//! `#equ ... #end equ` restore the output mode they found. The grammar is in docs/sheet-syntax.md
//! ("Dimension figures"). This is our addition and not part of CalcpadCE.

use crate::expr::{self, Ctx};

/// One compiled figure: Calcpad lines with the sheet line each comes from, and the problems found.
pub struct Figure {
    pub lines: Vec<(String, usize)>,
    pub errors: Vec<(usize, String)>,
}

/// A coordinate: a number known now, or a Calcpad expression the engine works out.
#[derive(Clone, Debug)]
enum C {
    N(f64),
    E(String),
}

impl C {
    fn known(&self) -> Option<f64> {
        match self {
            C::N(v) => Some(*v),
            C::E(_) => None,
        }
    }
    fn src(&self) -> String {
        match self {
            C::N(v) => num(*v),
            C::E(e) => format!("({e})"),
        }
    }
    fn add(&self, o: &C) -> C {
        match (self, o) {
            (C::N(a), C::N(b)) => C::N(a + b),
            (C::N(z), x) | (x, C::N(z)) if *z == 0.0 => x.clone(),
            _ => C::E(format!("{} + {}", self.src(), o.src())),
        }
    }
    fn sub(&self, o: &C) -> C {
        match (self, o) {
            (C::N(a), C::N(b)) => C::N(a - b),
            (x, C::N(z)) if *z == 0.0 => x.clone(),
            _ => C::E(format!("{} - {}", self.src(), o.src())),
        }
    }
    fn mul(&self, o: &C) -> C {
        match (self, o) {
            (C::N(a), C::N(b)) => C::N(a * b),
            (C::N(z), _) | (_, C::N(z)) if *z == 0.0 => C::N(0.0),
            (C::N(u), x) | (x, C::N(u)) if *u == 1.0 => x.clone(),
            _ => C::E(format!("{}*{}", self.src(), o.src())),
        }
    }
    fn div(&self, o: &C) -> C {
        match (self, o) {
            (C::N(a), C::N(b)) if *b != 0.0 => C::N(a / b),
            (x, C::N(u)) if *u == 1.0 => x.clone(),
            _ => C::E(format!("{}/{}", self.src(), o.src())),
        }
    }
    fn hypot(&self, o: &C) -> C {
        match (self, o) {
            (C::N(a), C::N(b)) => C::N(a.hypot(*b)),
            _ => C::E(format!("sqrt({}^2 + {}^2)", self.src(), o.src())),
        }
    }
}

/// A number as short text: at most four decimals, no trailing zeros.
fn num(v: f64) -> String {
    let s = format!("{:.4}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

#[derive(Clone, Debug)]
struct P {
    x: C,
    y: C,
}

impl P {
    fn add(&self, o: &P) -> P {
        P {
            x: self.x.add(&o.x),
            y: self.y.add(&o.y),
        }
    }
    fn scale(&self, k: &C) -> P {
        P {
            x: self.x.mul(k),
            y: self.y.mul(k),
        }
    }
}

/// HTML text: `&`, `<`, `>` and quotes escaped. An apostrophe would end a Calcpad text line, so it
/// is written as a character reference.
pub(crate) fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#39;"),
            _ => o.push(c),
        }
    }
    o
}

/// Splits on white space outside braces.
fn words(s: &str) -> Result<Vec<&str>, String> {
    let mut out = Vec::new();
    let (mut depth, mut start) = (0i32, None);
    for (i, c) in s.char_indices() {
        match c {
            '{' => {
                depth += 1;
                start.get_or_insert(i);
            }
            '}' => {
                depth -= 1;
                if depth < 0 {
                    return Err("a '}' without its '{'".into());
                }
            }
            c if c.is_whitespace() && depth == 0 => {
                if let Some(a) = start.take() {
                    out.push(&s[a..i]);
                }
            }
            _ => {
                start.get_or_insert(i);
            }
        }
    }
    if depth != 0 {
        return Err("a '{' is never closed".into());
    }
    if let Some(a) = start {
        out.push(&s[a..]);
    }
    Ok(out)
}

/// The first `|` outside braces: the shape, then the label.
fn split_label(s: &str) -> (&str, Option<&str>) {
    let mut depth = 0i32;
    for (i, c) in s.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            '|' if depth == 0 => return (s[..i].trim(), Some(s[i + 1..].trim())),
            _ => {}
        }
    }
    (s.trim(), None)
}

/// `expr` or `expr -> unit` inside braces: the Calcpad expression and the unit, if any.
fn value(inner: &str, ctx: &Ctx) -> Result<(String, Option<(String, String)>), String> {
    let inner = inner.trim();
    let (e, u) = match inner.rfind("->") {
        Some(p) => (inner[..p].trim(), Some(inner[p + 2..].trim())),
        None => (inner, None),
    };
    if e.is_empty() {
        return Err("an empty value '{}'".into());
    }
    let e = expr::translate(e, ctx).map_err(|m| format!("'{e}' is not an expression: {m}"))?;
    let u = match u {
        Some(u) => Some((
            expr::translate_unit(u).map_err(|m| format!("'{u}' is not a unit: {m}"))?,
            u.to_string(),
        )),
        None => None,
    };
    Ok((e, u))
}

/// A coordinate: a number, or `{expr}` / `{expr -> unit}` (the number of that unit).
fn coord(s: &str, ctx: &Ctx) -> Result<C, String> {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix('{').and_then(|r| r.strip_suffix('}')) {
        let (e, u) = value(inner, ctx)?;
        return Ok(match u {
            Some((u, _)) => C::E(format!("({e})/(1*({u}))")),
            None => C::E(e),
        });
    }
    s.parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
        .map(C::N)
        .ok_or_else(|| format!("'{s}' is not a number or a {{value}}"))
}

/// `x,y`: the comma outside braces.
fn point(s: &str, ctx: &Ctx) -> Result<P, String> {
    let mut depth = 0i32;
    for (i, c) in s.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            ',' if depth == 0 => {
                return Ok(P {
                    x: coord(&s[..i], ctx)?,
                    y: coord(&s[i + 1..], ctx)?,
                });
            }
            _ => {}
        }
    }
    Err(format!("'{s}' is not a point (write x,y with no space, as 120,40)"))
}

/// A CSS colour as written: a name, `#rgb`, `#rrggbb`, or `rgb(...)` with no quotes or `;`.
fn colour(s: &str) -> Result<String, String> {
    let ok = !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '#' | '(' | ')' | ',' | '.' | '%'));
    if ok {
        Ok(s.to_string())
    } else {
        Err(format!("'{s}' is not a colour"))
    }
}

/// A segment of a label: text, or a value.
enum Seg {
    Text(String),
    /// A name alone, written by the engine as `name = value unit`.
    Named(String),
    /// A value written as its number, with the unit text after it if one was asked for.
    Val(String, Option<String>),
}

fn label(s: &str, ctx: &Ctx) -> Result<Vec<Seg>, String> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(a) = rest.find('{') {
        if a > 0 {
            out.push(Seg::Text(rest[..a].to_string()));
        }
        let b = rest[a..].find('}').ok_or("a '{' in the label is never closed")? + a;
        let inner = &rest[a + 1..b];
        let (e, u) = value(inner, ctx)?;
        let bare = inner.trim();
        out.push(match u {
            Some((cp, written)) => Seg::Val(format!("{e}|{cp}"), Some(written)),
            None if crate::names::is_name(bare) => Seg::Named(e),
            None => Seg::Val(e, None),
        });
        rest = &rest[b + 1..];
    }
    if rest.contains('}') {
        return Err("a '}' in the label without its '{'".into());
    }
    if !rest.is_empty() {
        out.push(Seg::Text(rest.to_string()));
    }
    Ok(out)
}

struct Style {
    colour: String,
    /// Stroke width in picture pixels.
    sw: f64,
    /// Label font size in CSS px at the picture's own width.
    font: f64,
}

/// What the figure draws, element by element.
struct Out {
    svg: Vec<(String, usize, bool)>,
    labels: Vec<(Vec<(String, usize)>, usize)>,
}

impl Out {
    fn svg(&mut self, s: String, line: usize, dynamic: bool) {
        self.svg.push((s, line, dynamic));
    }
}

fn is_dyn(cs: &[&C]) -> bool {
    cs.iter().any(|c| c.known().is_none())
}

/// An SVG attribute value: the number, or the expression for the engine to write (in `#val` mode).
fn att(c: &C) -> String {
    match c {
        C::N(v) => num(*v),
        C::E(e) => format!("'{e}'"),
    }
}

fn line_el(a: &P, b: &P, st: &Style, extra: &str) -> (String, bool) {
    let d = is_dyn(&[&a.x, &a.y, &b.x, &b.y]);
    (
        format!(
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{}\" stroke-width=\"{}\"{extra}/>",
            att(&a.x),
            att(&a.y),
            att(&b.x),
            att(&b.y),
            st.colour,
            num(st.sw)
        ),
        d,
    )
}

/// A label centred on `at`, turned by `angle` degrees, over a white box so it reads across lines.
#[allow(clippy::too_many_arguments)]
fn place_label(out: &mut Out, segs: Vec<Seg>, at: &P, angle: f64, w: f64, h: f64, st: &Style, idx: usize) {
    let left = at.x.mul(&C::N(100.0 / w));
    let top = at.y.mul(&C::N(100.0 / h));
    let rot = if angle.abs() > 0.01 {
        format!(" rotate({}deg)", num(angle))
    } else {
        String::new()
    };
    let open = format!(
        "<div class=\"ck-dim-label\" style=\"position:absolute;left:{}%;top:{}%;transform:translate(-50%,-50%){rot};\
         white-space:nowrap;padding:0 .25em;background:rgba(255,255,255,.85);color:{};font:{}px/1.2 sans-serif;pointer-events:none\">",
        att(&left),
        att(&top),
        st.colour,
        num(st.font)
    );
    let mut ls = Vec::new();
    let dynamic = is_dyn(&[&left, &top]);
    if dynamic {
        ls.push(("#val".to_string(), idx));
    }
    ls.push((format!("'{open}"), idx));
    if dynamic {
        ls.push(("#end val".to_string(), idx));
    }
    for s in segs {
        match s {
            Seg::Text(t) => ls.push((format!("'<span>{}</span>", esc(&t)), idx)),
            Seg::Named(e) => {
                ls.push(("#equ".to_string(), idx));
                ls.push((format!("'<span class=\"ck-dim-v\">'{e}'</span>"), idx));
                ls.push(("#end equ".to_string(), idx));
            }
            Seg::Val(e, u) => {
                let unit = u.map(|u| format!("\u{2009}{}", esc(&u))).unwrap_or_default();
                ls.push(("#val".to_string(), idx));
                ls.push((format!("'<span class=\"ck-dim-v\">'{e}'{unit}</span>"), idx));
                ls.push(("#end val".to_string(), idx));
            }
        }
    }
    ls.push(("'</div>".to_string(), idx));
    out.labels.push((ls, idx));
}

/// The angle in degrees (screen, clockwise) of a direction, turned to read left to right.
fn reading_angle(dx: f64, dy: f64) -> f64 {
    let mut a = dy.atan2(dx).to_degrees();
    if a > 90.0 {
        a -= 180.0;
    } else if a <= -90.0 {
        a += 180.0;
    }
    a
}

/// Draws a dimension: `kind` is "dim" (aligned), "hdim" (horizontal) or "vdim" (vertical).
#[allow(clippy::too_many_arguments)]
fn dimension(
    out: &mut Out,
    kind: &str,
    p1: P,
    p2: P,
    off: f64,
    segs: Vec<Seg>,
    w: f64,
    h: f64,
    st: &Style,
    idx: usize,
) {
    let gap = C::N(st.sw * 2.0);
    let over = C::N(st.sw * 4.0);
    let sgn = if off < 0.0 { -1.0 } else { 1.0 };
    let (q1, q2, e1, e2, angle);
    match kind {
        "hdim" => {
            // The line at y1 - offset (a positive offset is above P1), across the two x.
            let y = p1.y.sub(&C::N(off));
            q1 = P {
                x: p1.x.clone(),
                y: y.clone(),
            };
            q2 = P {
                x: p2.x.clone(),
                y: y.clone(),
            };
            let beyond = y.sub(&over.mul(&C::N(sgn)));
            e1 = (
                P {
                    x: p1.x.clone(),
                    y: p1.y.sub(&gap.mul(&C::N(sgn))),
                },
                P {
                    x: p1.x.clone(),
                    y: beyond.clone(),
                },
            );
            e2 = (
                P {
                    x: p2.x.clone(),
                    y: p2.y.sub(&gap.mul(&C::N(sgn))),
                },
                P {
                    x: p2.x.clone(),
                    y: beyond,
                },
            );
            angle = 0.0;
        }
        "vdim" => {
            // The line at x1 - offset (a positive offset is left of P1), across the two y.
            let x = p1.x.sub(&C::N(off));
            q1 = P {
                x: x.clone(),
                y: p1.y.clone(),
            };
            q2 = P {
                x: x.clone(),
                y: p2.y.clone(),
            };
            let beyond = x.sub(&over.mul(&C::N(sgn)));
            e1 = (
                P {
                    x: p1.x.sub(&gap.mul(&C::N(sgn))),
                    y: p1.y.clone(),
                },
                P {
                    x: beyond.clone(),
                    y: p1.y.clone(),
                },
            );
            e2 = (
                P {
                    x: p2.x.sub(&gap.mul(&C::N(sgn))),
                    y: p2.y.clone(),
                },
                P {
                    x: beyond,
                    y: p2.y.clone(),
                },
            );
            angle = -90.0;
        }
        _ => {
            // Aligned: the normal on the left of P1 -> P2 (above, for a line drawn left to right).
            let dx = p2.x.sub(&p1.x);
            let dy = p2.y.sub(&p1.y);
            let len = dx.hypot(&dy);
            let n = P {
                x: dy.div(&len),
                y: C::N(0.0).sub(&dx).div(&len),
            };
            let o = n.scale(&C::N(off));
            q1 = p1.add(&o);
            q2 = p2.add(&o);
            let g = n.scale(&gap.mul(&C::N(sgn)));
            let b = n.scale(&C::N(off).add(&over.mul(&C::N(sgn))));
            e1 = (p1.add(&g), p1.add(&b));
            e2 = (p2.add(&g), p2.add(&b));
            angle = match (dx.known(), dy.known()) {
                (Some(a), Some(b)) => reading_angle(a, b),
                _ => 0.0,
            };
        }
    }
    if off != 0.0 {
        for (a, b) in [&e1, &e2] {
            let (s, d) = line_el(a, b, st, " stroke-opacity=\".8\"");
            out.svg(s, idx, d);
        }
    }
    let (s, d) = line_el(&q1, &q2, st, " marker-start=\"url(#{M})\" marker-end=\"url(#{M})\"");
    out.svg(s, idx, d);
    if !segs.is_empty() {
        let mid = P {
            x: q1.x.add(&q2.x).mul(&C::N(0.5)),
            y: q1.y.add(&q2.y).mul(&C::N(0.5)),
        };
        place_label(out, segs, &mid, angle, w, h, st, idx);
    }
}

/// Compiles the body of a ```dim fence. `body` holds (line text, sheet line); `open` is the fence's line.
pub fn compile(body: &[(String, usize)], open: usize, seq: usize, ctx: &Ctx) -> Figure {
    let mut errors = Vec::new();
    let mut image: Option<(String, f64, f64, Option<String>, String)> = None;
    let mut st = Style {
        colour: "#d32f2f".into(),
        sw: 0.0,
        font: 0.0,
    };
    let mut out = Out {
        svg: Vec::new(),
        labels: Vec::new(),
    };
    for (raw, idx) in body {
        let idx = *idx;
        let t = raw.trim();
        if t.is_empty() || t.starts_with("//") {
            continue;
        }
        let (shape, lab) = split_label(t);
        let ws = match words(shape) {
            Ok(w) => w,
            Err(m) => {
                errors.push((idx, m));
                continue;
            }
        };
        let Some(&kw) = ws.first() else {
            errors.push((idx, "a label with nothing to place it on".into()));
            continue;
        };
        let kw = kw.to_ascii_lowercase();
        if kw == "image" {
            // image FILE WxH [width CSS] [alt TEXT...]
            if image.is_some() {
                errors.push((idx, "a second 'image' line (a figure has one picture)".into()));
                continue;
            }
            let file = ws.get(1).copied().unwrap_or("");
            let size = ws.get(2).and_then(|s| s.split_once(['x', 'X', '×']));
            let size = size.and_then(|(a, b)| Some((a.parse::<f64>().ok()?, b.parse::<f64>().ok()?)));
            if file.is_empty() || file.contains(['"', '\'', '<', '>']) {
                errors.push((
                    idx,
                    "write 'image FILE WIDTHxHEIGHT', as: image beam.png 800x400".into(),
                ));
                continue;
            }
            let Some((w, h)) = size.filter(|(w, h)| *w > 0.0 && *h > 0.0) else {
                errors.push((
                    idx,
                    format!("give the size of '{file}' in pixels after the file name, as: image {file} 800x400"),
                ));
                continue;
            };
            let mut width = None;
            let mut i = 3;
            let mut alt = String::new();
            while i < ws.len() {
                match ws[i].to_ascii_lowercase().as_str() {
                    "width" if i + 1 < ws.len() => {
                        let v = ws[i + 1];
                        let css = if v.parse::<f64>().is_ok() {
                            format!("{v}px")
                        } else {
                            v.to_string()
                        };
                        if css.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '%') {
                            width = Some(css);
                        } else {
                            errors.push((idx, format!("'{v}' is not a width (as 600, 600px or 80%)")));
                        }
                        i += 2;
                    }
                    "alt" => {
                        alt = ws[i + 1..].join(" ");
                        break;
                    }
                    other => {
                        errors.push((idx, format!("'{other}' is not an option of 'image' (width, alt)")));
                        i += 1;
                    }
                }
            }
            st.sw = (w.max(h) / 400.0).max(1.0);
            st.font = (w.max(h) / 45.0).clamp(11.0, 18.0).round();
            image = Some((file.to_string(), w, h, width, alt));
            continue;
        }
        if kw == "color" || kw == "colour" {
            // `color blue` alone sets the colour of the lines after it.
            match ws.get(1).filter(|_| ws.len() == 2 && lab.is_none()).map(|c| colour(c)) {
                Some(Ok(c)) => st.colour = c,
                Some(Err(m)) => errors.push((idx, m)),
                None => errors.push((idx, "write 'color NAME', as: color blue".into())),
            }
            continue;
        }
        let Some((_, w, h, _, _)) = image.clone() else {
            errors.push((
                idx,
                "the figure starts with its picture: image FILE WIDTHxHEIGHT".into(),
            ));
            continue;
        };
        // The options after the points.
        let mut pts = Vec::new();
        let mut off = 0.0;
        let mut bad = None;
        let mut i = 1;
        let mut el_style = Style {
            colour: st.colour.clone(),
            sw: st.sw,
            font: st.font,
        };
        while i < ws.len() {
            let wd = ws[i];
            let key = wd.to_ascii_lowercase();
            match key.as_str() {
                "offset" | "color" | "colour" | "size" => {
                    let Some(v) = ws.get(i + 1) else {
                        bad = Some(format!("'{wd}' needs a value"));
                        break;
                    };
                    match key.as_str() {
                        "offset" => match v.parse::<f64>() {
                            Ok(o) if o.is_finite() => off = o,
                            _ => bad = Some(format!("the offset '{v}' is not a number (pixels of the picture)")),
                        },
                        "size" => match v.parse::<f64>() {
                            Ok(f) if f > 0.0 => el_style.font = f,
                            _ => bad = Some(format!("the text size '{v}' is not a number")),
                        },
                        _ => match colour(v) {
                            Ok(c) => el_style.colour = c,
                            Err(m) => bad = Some(m),
                        },
                    }
                    i += 2;
                }
                _ => {
                    match point(wd, ctx) {
                        Ok(p) => pts.push(p),
                        Err(m) => {
                            bad = Some(m);
                            break;
                        }
                    }
                    i += 1;
                }
            }
        }
        if let Some(m) = bad {
            errors.push((idx, m));
            continue;
        }
        let segs = match lab.map(|l| label(l, ctx)).transpose() {
            Ok(s) => s.unwrap_or_default(),
            Err(m) => {
                errors.push((idx, m));
                continue;
            }
        };
        match kw.as_str() {
            "dim" | "hdim" | "vdim" => {
                if pts.len() != 2 {
                    errors.push((
                        idx,
                        format!("'{kw}' takes two points, as: {kw} 60,330 740,330 offset 40 | {{L}}"),
                    ));
                    continue;
                }
                let p2 = pts.pop().unwrap();
                let p1 = pts.pop().unwrap();
                dimension(&mut out, &kw, p1, p2, off, segs, w, h, &el_style, idx);
            }
            "line" => {
                if pts.len() < 2 {
                    errors.push((idx, "'line' takes two points or more".into()));
                    continue;
                }
                for ab in pts.windows(2) {
                    let (s, d) = line_el(&ab[0], &ab[1], &el_style, "");
                    out.svg(s, idx, d);
                }
                if !segs.is_empty() {
                    let (a, b) = (&pts[0], &pts[pts.len() - 1]);
                    let mid = P {
                        x: a.x.add(&b.x).mul(&C::N(0.5)),
                        y: a.y.add(&b.y).mul(&C::N(0.5)),
                    };
                    place_label(&mut out, segs, &mid, 0.0, w, h, &el_style, idx);
                }
            }
            "text" => {
                if pts.len() != 1 || segs.is_empty() {
                    errors.push((
                        idx,
                        "'text' takes one point and a label, as: text 400,200 | w = {w}".into(),
                    ));
                    continue;
                }
                let p = pts.pop().unwrap();
                place_label(&mut out, segs, &p, 0.0, w, h, &el_style, idx);
            }
            _ => errors.push((
                idx,
                format!("'{kw}' is not a figure line (image, dim, hdim, vdim, line, text, color)"),
            )),
        }
    }
    let mut lines = Vec::new();
    let Some((file, w, h, width, alt)) = image else {
        if errors.is_empty() {
            errors.push((
                open,
                "the figure has no picture: start it with image FILE WIDTHxHEIGHT".into(),
            ));
        }
        return Figure { lines, errors };
    };
    let marker = format!("ck-dim-{seq}");
    let width = width.unwrap_or_else(|| format!("{}px", num(w)));
    let alt = if alt.is_empty() {
        "Dimensioned figure".to_string()
    } else {
        alt
    };
    lines.push((
        format!(
            "'<div class=\"ck-dimfig\" style=\"position:relative;display:inline-block;width:{width};max-width:100%;aspect-ratio:{} / {};margin:.4em 0;line-height:0;break-inside:avoid\">",
            num(w),
            num(h)
        ),
        open,
    ));
    lines.push((
        format!(
            "'<img src=\"{}\" alt=\"{}\" style=\"display:block;width:100%;height:100%\">",
            esc(&file),
            esc(&alt)
        ),
        open,
    ));
    let ms = num(st.sw * 7.0);
    lines.push((
        format!(
            "'<svg viewBox=\"0 0 {} {}\" preserveAspectRatio=\"none\" aria-hidden=\"true\" style=\"position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible\">\
             <defs><marker id=\"{marker}\" viewBox=\"0 0 10 10\" refX=\"10\" refY=\"5\" markerUnits=\"userSpaceOnUse\" markerWidth=\"{ms}\" markerHeight=\"{ms}\" orient=\"auto-start-reverse\">\
             <path d=\"M0,1 L10,5 L0,9 z\" fill=\"context-stroke\"/></marker></defs>",
            num(w),
            num(h)
        ),
        open,
    ));
    let mut in_val = false;
    for (s, idx, d) in out.svg {
        if d != in_val {
            lines.push((if d { "#val" } else { "#end val" }.to_string(), idx));
            in_val = d;
        }
        lines.push((format!("'{}", s.replace("{M}", &marker)), idx));
    }
    if in_val {
        lines.push(("#end val".to_string(), open));
    }
    lines.push(("'</svg>".to_string(), open));
    for (ls, _) in out.labels {
        lines.extend(ls);
    }
    let close = body.last().map(|(_, i)| *i + 1).unwrap_or(open);
    lines.push(("'</div>".to_string(), close));
    Figure { lines, errors }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn run(src: &str) -> Figure {
        let defined: HashSet<String> = ["L", "h", "w"].iter().map(|s| s.to_string()).collect();
        let ctx = Ctx {
            defined: &defined,
            cond: false,
        };
        let body: Vec<(String, usize)> = src.lines().enumerate().map(|(i, l)| (l.to_string(), i + 1)).collect();
        compile(&body, 0, 1, &ctx)
    }

    #[test]
    fn static_numbers_are_worked_out_now() {
        let f = run("image a.png 800x400\ndim 0,300 800,300 offset 100 | {L}");
        assert!(f.errors.is_empty(), "{:?}", f.errors);
        let t: Vec<&str> = f.lines.iter().map(|l| l.0.as_str()).collect();
        let all = t.join("\n");
        // Left to right: the normal is up, so the line is at y = 200.
        assert!(all.contains("<line x1=\"0\" y1=\"200\" x2=\"800\" y2=\"200\""), "{all}");
        // No expression in the drawing, so no #val around it.
        assert!(!all.contains("#val\n'<line"), "{all}");
        // A name alone: the engine's `L = 6 m`.
        assert!(
            all.contains("#equ\n'<span class=\"ck-dim-v\">'L'</span>\n#end equ"),
            "{all}"
        );
        assert!(all.contains("left:50%;top:50%"), "{all}");
    }

    #[test]
    fn values_in_coordinates_go_to_the_engine() {
        let f = run("image a.png 800x400\nhdim 0,300 {L -> m}*100,300 | {L -> mm}");
        // `{L -> m}*100` is not a coordinate: a value must be the whole coordinate.
        assert_eq!(f.errors.len(), 1, "{:?}", f.errors);
        let f = run("image a.png 800x400\nhdim 0,300 {L/(1 m)*100},300 offset 20 | {L -> mm}");
        assert!(f.errors.is_empty(), "{:?}", f.errors);
        let all = f.lines.iter().map(|l| l.0.as_str()).collect::<Vec<_>>().join("\n");
        assert!(all.contains("#val\n'<line"), "{all}");
        assert!(all.contains("x2=\"'L/(1 m)*100'\""), "{all}");
        assert!(all.contains("'L|mm'\u{2009}mm"), "{all}");
    }

    #[test]
    fn problems_are_reported_on_their_lines() {
        let f = run("dim 0,0 1,1\nimage a.png\nimage a.png 10x10\ndim 0,0 | {L}\nbox 1,1\ntext 1,1 | {L");
        let lines: Vec<usize> = f.errors.iter().map(|e| e.0).collect();
        assert_eq!(lines, vec![1, 2, 4, 5, 6], "{:?}", f.errors);
    }
}
