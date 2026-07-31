Willkommen in Typst! Die unmittelbare Texteinheit von Typst ist ein Absatz. Sobald wir in ein leeres Dokument schreiben, haben wir bereits einen Absatz begonnen. Das hier ist ein Absatz.
Ein einziger Zeilenumbruch in unserer Quelldatei genügt nicht, um Absätze voneinander zu trennen. 
Nicht einmal, um einen Zeilenumbruch zu erzwingen. 
Stattdessen wird ein einfacher Zeilenumbruch von Typst wie ein einfaches Spatium gelesen.
Das Ganze dient dazu, den Text im `source code` besser strukturieren zu können.
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

Wir kennen bisher aulso zwei automatisch erkannte Blöcke: Absätze und Listen.

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

== Code 

Mit der Zeile

```typst
#pagebreak()
```

haben wir schon die bedeutsamste Neuerung  im Vergleich zu herkömmlichen Textformaten gesehen: in Typst vermischt sich _Text_ mit _Code,_ um das final ausgegbene Dokument nach Anweisung zu erstellen. 
Die Mögichkeit, mit Code zu arbeiten, macht Typst erst interessant und nützlich.
Die eingestreuten Anweisungen erlauben uns, das Dokument genau so zu gestalten, wie wir es haben wollen.
Die Möglichkeit, Seiten, Absätze und Text zu programmieren (in \~Etwa analog zu Seiten-, Absatz- und Zeichenformaten), gibt Typst einen viel größeren Funktionumfang als _WYSIWYG-Editoren_#footnote[_What You See Is What You Get_ -- wie Word, LibreOffice oder InDesign. Ganz anders hier: hier wird Quellcode geschrieben, and what you get is what you don't see -- it's what you tell the program to do.].