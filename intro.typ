Willkommen in Typst! Die unmittelbare Texteinheit von Typst ist ein Absatz. Sobald wir in ein leeres Dokument schreiben, haben wir bereits einen Absatz begonnen. Das hier ist ein Absatz.
Ein einziger Zeilenumbruch in unserem Code genügt nicht, um Absätze voneinander zu trennen. 
Nicht einmal, um einen Zeilenumbruch zu erzwingen. 
Stattdessen wird ein einfacher Zeilenumbruch von Typst wie ein einfaches Spatium gelesen.
Das Ganze dient dazu, den Text im Quelltext besser strukturieren zu können.
Man kann so einzelne kleine Einheiten, wie Sätze oder Gedanken bilden, die sich nicht sofort im ausgegebenen Dokument niederschlagen.
Nur für sich selber sozusagen.
Und außerdem lässt es sich so leichter im `code` navigieren.

Mit einem doppeltem Umbruch kommt hier der zweite Absatz. 

Einen manuellen Zeilenumbruch kann man erzwingen, indem man einen Backslash ('\\') ans Ende der Zeile setzt. So: \
Der manuelle Zeilenumbruch ist selten nötig, vielleicht am ehesten beispielsweise bei Gedichten  oder anderen Phänomenen der Literatur, wenn der Zeilenumbruch semantisch bedeutsam und klar vom Absatzumbruch unterschieden (und keine Frage des Textsatzes) ist. 

- Alle anderen Blöcke, die nicht Absätze sind, wie Überschriften, Listen, Blockzitate, Formeln etc. haben eigene Satzregeln und werden automatisch erkannt oder gekennzeichnet. \
    Das hier ist ein eingezogener Abschnitt. Er beginnt mit einem Tabulator.
- In Listen funktioniert der Umbruch anders, und intuitiv, wie er soll. jede Zeile, die mit einem Minus ('-') beginnt, ist automatisch ein neuer Listenpunkt.
    + Hier ein Unterpunkt,
    + aber einer geordneten Liste,
    + deren Elemente mit einem Plus ('+') beginnen.

Wir kennen jetzt also zwei automatisch erkannte Blöcke: Absätze und Listen.

= Andere Blöcke, $<-$ Überschrift erster Ebene ('=')
== die verwendet werden können $<-$ Überschrift zweiter Ebene ('==' usw.)

/ Term: Das hier ist die Definition eines Begriffs, auch dafür hat Typst eine Kurzform
/ Benutzung:  Dazu schreibt man erst einen forward Slash ('/') an den Satzanfang, ein Spatium, den Term, der definiert werden soll und schließlich einen Doppelpunkt, gefolgt von der Definition. Verwendet wird das vor allem in der Mathematik oder Naturwissenschaft. 

// Ein besonderer Block ist der Kommentar
/* Dieser hier ist sogar mehrzeilig.
Kommentare stehen nur im code und werden nicht ausgegeben.
Das hier steht nicht im Dokument.
Sie sind ganz hilfreich für eigene kleine Anmerkungen oder zum Korrekturlesen.  */


```
Code ist auch ein Block mit einem Shortcut. In einem Code-Block gibt es keine reservierten oder besonderen Zeichen:
= Auch die Umbruchregeln gelten nicht mehr. Es gibt keine automatische Ersetzungen oder Formatierungen. Alles wird so ausgegeben, wie geschrieben. Ansonsten könnte man ja keinen Code einbetten. Man nennt diesen Block deswegen auch 'code fence'.
```

```xml
<Language>
    <Capability>Man kann sogar die Sprache eines Code-Blocks angeben.</Capability>
    <Effect>Die Ausgabe wird dann je nach Sprache farbig formatiert.</Effect> 
</Language>
``` 

Das war's mit der ersten Seite und Vanilla-Typst-Features. Vielleicht noch zuletzt ein paar eingebaute Shortcuts für *Zeichenformate* $<-$ das ist Fett, dazu benutzen wir zwei Sternchen. _Das ist Emphase_ ('\_'), eine alternative Hervorhebung. `Inline-code` -- das geht mit zwei Backticks ('\`'). Wenn wir ein Zeichen benutzen wollen, ohne eine Formatierung auszulösen, verwenden wir als _Escape_-Zeichen einen Backslash ('\\'). Das bedeutet: wir meinen hier keine Formatierung, sondern wollen einfach das entsprechende Zeichen setzen, zB. \* oder \_ oder \\ oder wir setzen \\= am Zeilenbeginn. 

#pagebreak()

== \#Code...

Mit der Zeile

```typst
#pagebreak()
```

haben wir schon die bedeutsamste Neuerung  im Vergleich zu herkömmlichen Textformaten gesehen: in Typst vermischt sich _Text_ mit _Code,_ um das final ausgegbene Dokument nach Anweisung zu erstellen.
Die _Funktion_ `#pagebreak()` löst einen erzwungenen Seitenumbruch aus; und zwar genau an der Stelle, an welcher sie aufgerufen wird.
Die Mögichkeit, mit Code zu arbeiten, macht Typst erst interessant und nützlich.
Die eingestreuten Anweisungen erlauben uns, das Dokument genau so zu gestalten, wie wir es haben wollen.
Die Möglichkeit, Seiten, Absätze und Text zu programmieren (in \~Etwa analog zu Seiten-, Absatz- und Zeichenformaten), gibt Typst einen viel größeren Funktionumfang als _WYSIWYG-Editoren_#footnote[_What You See Is What You Get_ -- wie Word, LibreOffice oder InDesign. Ganz anders hier: hier wird Quellcode geschrieben, and what you get is what you don't see -- it's what you tell the program to do.].

Damit ist ein weiteres Sonderzeichen, die Raute '\#' eingeführt. Die Raute signalisiert: jetzt kommt Code, jetzt kommt eine Funktion, die ausgeführt werden soll. Auch sie müssen wir _escapen_ wenn wir sie als Zeichen benutzen wollen.

== ...und \[Text\] 

Wir ändern mal die Schriftart:

```typst
#set text(font: "<Font Name>")
```

#set text(font: ("Linux Biolinum O", "Libre Baskerville", "Gill Sans", "sans-serif")) 

Ab sofort ist die Schiftart anders. Wir sehen, die Schrift ändert sich, und zwar genau wie oben, ab der Stelle, an welcher die Funktion aufgerufen wird. 

Wir müssen aber nicht immer zwingend alle Änderungen an Zeichen- oder Absatzformaten für den gesamten kommenden Text festlegen. Dazu gibt es, quasi als Umkehrung von '\#' \[die eckige Klammer\] '\['; so wird _Text_ in Code-Kontexten eingeschlossen. Die aufgehende Klammer \[ bedeutet: jetzt kommt ein Textkontext, und nicht code. Damit können wir Textstile lokal begrenzen:

#upper()[Das hier ist groß geschrieben.] #lower()[Das KLEIN.] 

Nach der Schließung der eckigen Klammer '\]' geht es wie zuvor weiter.

== Argumente

Wie oben, bei der Änderung der Schriftart, können bestimmte Funktionen auch Argumente haben. Argumente sind Zusatzinformationen, die sich auf die Ausführung der jeweiligen Funktion beziehen, und werden in runde Klammern eingeschlossen: #highlight(fill: yellow)[Das kannste dir merken.] Die Syntax ist also `#Funktion(Argumentname: Argumentwert)` Funktionen können optionale und erforderliche Argumente haben.

```typst
#upper()[Das hier ist groß geschrieben]. #lower()[Das KLEIN.] 
#highlight(fill: yellow)[Das kannste dir merken.]
```

Man kann aber nicht schreiben:

```typst
#upper(fill: yellow)[Das hier ist groß geschrieben]
```

Weil die Funktion `upper` das Argument `fill` nicht kennt, die Funktion `highlight` hingegen schon. Wie in einer Programmiersprache auch, gibt es bestimmte Datentypen für die Werte der Argumente: ich kann `fill: yellow` schreiben, weil der Wert der Variable `yellow` Typst bekannt ist. Den Wert `rose` hätte Typst abgelehnt. Das ginge nur mit rgb("\#ffc4e1"), #highlight(fill: rgb("#ffc4e1"))[ dem Hex-Code der Farbe.]

#set page(
  paper: "a4",
  margin: (top: 25mm, right: 44mm, bottom: 35mm, left: 25mm),
  footer: [
    #set text(size: 9pt)
    #grid(
      columns: (1fr, auto),
      [Vorführungsdokument Typst],
// Das keyword context sorgt dafür, dass der Footer nicht hier an dieser Stelle einmal ausgeführt wird, was das "normale" Typst-Verhalten wäre; sondern immer wieder an den Stellen, an welcher der im Kontext enthaltene Text gesetzt wird. So aktualisiert sich die Seitenzahl auf jeder Seite.
      context {
        counter(page).display("1")
      }
    )
  ]
)

#set text(
    lang: "de",
    hyphenate: true,
)

#set par(
    leading: 0.68em,
)

== Dokument 

Die Funktion `#page` bezieht sich nicht auf Text, sondern auf die Seiteneinrichtung. Mit dem Argument ` paper: "a4"` lässt sich die Seitengröße einstellen, `margin` dient zur Angabe der Seitenränder.
Dieser Teil:

```Typst
#set page(
  footer: [
    #set text(size: 9pt)
    #grid(
      columns: (1fr, auto),
      [Vorführungsdokument Typst],
      context {
        counter(page).display("1")
      }
    )
  ]
)
```
ist etwas komplexer. Im Grunde wird eine Schriftgröße festgesetzt und außerdem angegeben, was in jeder von zwei Spalten im Footer gezeigt wird. Ein bisschen schwieriger ist das `#context`_-Keyword_, über welches man alles #link("https://typst.app/docs/reference/context/")[$->$ hier] nachlesen kannn. Zusätzlich haben wir mit der `#text()`-Funktion die Sprache des Textes angegeben, und die Silbentrennung eingestellt (sehr wichtig!). Die letzte Funktion `#par()` ist das dritte Ding im Bunde neben Zeichen- und Seitenformatierung -- nämlich die Absatzformatierung. `leading` ist dabei der Zeilenabstand.

== Auto-Ersetzungen und `#show`-Rules

Unsere Shortcuts von vorhin sind deswegen Shortcuts, weil sie die Verwendung einer Funktion abkürzen. Man müsste statt `_Hervorgehoben_` immer `#emph()[Hervorgehoben]` schreiben. Weil wir aber den ganzen Kladderadaatsch nicht immer schreiben wollen, haben wir halt Shortcuts. Eins ist aber dasselbe wie das Andere. Beweis: _Hervorgehoben_ und #emph()[Hervorgehoben]. Es gibt eine Menge an Funktionen, die sich auf konkreten Text beziehen, und die Eigenschaften und Charakteristiken vom gesetzten Text bestimmen können. Wir haben nur eine kleine Auswahl kennen gelernt. 

Für bestimmte Zeichen und Zeichenkombinationen nimmt Typst immer Ersetzungen vor (vorausgesetzt, wir befinden uns nicht in einem Code Fence oder im Code). Hier eine Liste:

Jetzt richten wir erst einmal unsrer _Seite_ ein.



Man muß sich den ganzen Spaß nicht merken. Wenn man einige Typst-Dokumente wie  Aufsätze, Protokolle oder Hausarbeiten schreibt, geht das relativ schnell, weil man immer wieder nur die geichen Funktionen verwendet. Einer KI kann man das Typst-Handbuch als pdf füttern und dann einfach beschreiben, was man gerne hätte. 

== Pakete & Templates

Weil typst eine voll funktionsfähige Programmiersprache einbettet, lässt sich Typst auch unendlich erweitern. Es gibt deswegen inzwischen eine Vielzahl an Paketen, die den Funktionsumfang von Typst erweitern, beispielsweise neue Funktionen einführen, mit welchen man Diagramme oder, für die Humanities wichtig, Noten oder Betonungszeichen einfügen kann. Ein Paket kann kanz einfach eingebunden werden:

```typst
#import "@preview/touying:0.7.4": *
```

und schon kann man im Flgenden eine PowePoint-Präsentation in Typst erstellen. Hier eine (kreative) Auswahl:

```
https://typst.app/universe/package/quill -- Elektik-Diagramme zeichnen 
https://typst.app/universe/package/alchemist -- Skelette, Knochen einbetten
https://typst.app/universe/package/cetz -- Diagramme aus Daten zeichnen
https://typst.app/universe/package/deckz -- Spielkarten/Schachfiguren einbetten
```