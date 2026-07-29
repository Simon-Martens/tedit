#set document(
  title: "A short Typst introduction",
  author: "tedit",
)

#set page(
  paper: "a4",
  margin: (x: 24mm, y: 22mm),
  header: align(right, text(8pt, fill: gray)[Typst introduction]),
  footer: context align(center, text(8pt, fill: gray)[Page #counter(page).display("1")]),
)

#set text(font: "Libertinus Serif", size: 10.5pt)
#set par(justify: true, leading: 0.7em)
#set heading(numbering: "1.")

#let accent = rgb("4f7c16")
#let callout(title, body) = block(
  width: 100%,
  inset: 10pt,
  radius: 4pt,
  fill: accent.lighten(88%),
  stroke: 0.8pt + accent,
  [
    #text(weight: "bold", fill: accent)[#title]
    #v(4pt)
    #body
  ],
)

#align(center)[
  #text(24pt, weight: "bold", fill: accent)[A short Typst introduction]
  #v(5pt)
  #text(11pt, fill: gray)[A compact tour of common document features]
]

#v(16pt)

#callout[Edit this document][
  Change the source on the left and watch the PDF preview update. Typst combines
  lightweight markup with expressions introduced by the `#` character.
]

#outline(title: [Contents], indent: 1em)

= Text and structure

Headings begin with one or more equals signs. Text can be *bold*, _italic_,
or `monospaced`. Use #link("https://typst.app/docs/")[links] to reference the
Typst documentation.

== Lists

- Unordered lists use a dash.
- Items may contain *formatted text*.
  - Indentation creates nested lists.

+ Numbered lists use a plus sign.
+ Typst handles numbering automatically.
+ References and counters remain consistent when content moves.

== A quotation

#quote(block: true, attribution: [Donald Knuth])[
  Science is what we understand well enough to explain to a computer. Art is
  everything else we do.
]

= Layout

The `columns` function creates newspaper-style sections:

#columns(2, gutter: 18pt)[
  == Left column

  Typst layout functions accept named arguments. Measurements can use points,
  millimeters, centimeters, inches, or relative units.

  #line(length: 100%, stroke: 1pt + accent)

  == Right column

  Content blocks are enclosed in square brackets. They may contain markup,
  expressions, and other blocks.

  #align(center)[#text(18pt, fill: accent)[Simple and composable]]
]

= Mathematics

Inline mathematics uses dollar signs, such as $a^2 + b^2 = c^2$. Add spaces
inside the delimiters for a displayed equation:

$ integral_0^infinity e^(-x^2) dif x = sqrt(pi) / 2 $

Fractions, matrices, roots, limits, and aligned equations are built in:

$ mat(1, 2; 3, 4) arrow.r^("transforms") mat(a, b; c, d) $

= Tables and figures

#figure(
  table(
    columns: (1.2fr, 1fr, 1.4fr),
    inset: 7pt,
    stroke: 0.5pt + rgb("b7b9b0"),
    table.header(
      [*Feature*], [*Syntax*], [*Result*],
    ),
    [Emphasis], [`*important*`], [*important*],
    [Inline code], [``` `value` ```], [`value`],
    [Math], [`$x^2$`], [$x^2$],
  ),
  caption: [A table with flexible column widths.],
)

#figure(
  rect(
    width: 100%,
    height: 32mm,
    radius: 5pt,
    fill: gradient.linear(accent.lighten(65%), accent, angle: 15deg),
    align(center + horizon, text(18pt, fill: white, weight: "bold")[Figures can contain anything]),
  ),
  caption: [A styled rectangle used as figure content.],
)

= Reusable functions

The callout near the beginning was created with a custom function:

```typst
#let callout(title, body) = block(
  inset: 10pt,
  fill: green.lighten(90%),
  [*#title* #body],
)
```

Variables, loops, conditions, arrays, dictionaries, and functions make complex
templates reusable while the surrounding document remains readable.

#v(10pt)
#align(center)[
  #text(fill: gray)[Continue exploring at ]
  #link("https://typst.app/docs/")[typst.app/docs]
]
