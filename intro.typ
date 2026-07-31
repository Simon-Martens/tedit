Willkommen in Typst! Die erste und unmittelbarste Einheit von Typst ist ein Absatz. Sobald der Benutzer beginnt, in ein leeres Dokument zu schreiben, hat er bereits einen Absatz begonnen.
Ein einziger Zeilenumbruch genügt nicht, um Absätze zu trennen. 
Nicht mal, um einen Zeilenumbruch zu erzwingen. 
Stattdessen wird ein einfacher Zeilenumbruch von Typst wie ein Spatium gelesen.
Das Ganze dient dazu, den Text im `source code` besser strukturieren zu können.
Man kann so einzelne kleine Einheiten, wie Sätze oder Gedanken bilden, die sich nicht sofort im ausgegebenen Satz niederschlagen.
Nur für sich selber sozusagen.
Und außerdem lässt es sich so leichter im `code` navigieren.

Das hier ist erst der Beginn eines neuen Absatzes. 

Einen manuellen Zeilenumbruch kann man erzwingen, indem man einen Backslash ans Ende der Zeile setzt. Also so: \
Der manuelle Zeilenumbruch ist selten nötig, vielleicht am ehesten noch bei Gedichten beispielsweise oder anderen Phänomenen der Literatur, in welchem der Zeilenumbruch semantisch bedeutsam und klar vom Absatzumbruch unterschieden (und keine Frage etwa des Platzmanagements oder des Textsatzes) ist. 

- Alle anderen Blöcke, die nicht Absätze sind, wie Überschriften, Listen, Blockzitate, Formeln etc. haben eigene Satzregeln und werden automatisch erkannt oder gekennzeichnet. \
    Das hier ist ein eingezogener Abschnitt. Er beginnt mit einem Tab.
- In Listen funktioniert der Umbruch anders, und intuitiv, wie er soll. jede Zeile, die mit einem Minus ('-') beginnt, ist automatisch ein neuer Listenpunkt.
    + Hier ein Unterpunkt,
    + aber einer geordneten Liste,
    + die beginnt man mit einem Plus ('+') 

Die Aufzählung oben ist ein Beispiel eines automatisch erkannten Blocks. 

= Andere Blöcke, $<-$ Überschrift erster Ebene
== die verwendet werden können $<-$ Überschrift zweiter Ebene

/ Term: Das hier ist die Bedeutung eiens Begriffs, auch dafür hat Typst einen Shortcut
/ Benutzung:  Dazu schreibt man erst einen forward Slash ('/') an den Satzanfang, ein Spatium, den Term, der definiert werden soll und schließlich einen Doppelpunkt, gefolgt von der Definition. Bedeutsam ist das vor allem in der Mathematik oder Naturwissenschaft.

// Ein besonderer Block ist der Kommentar
/* Dieser hier ist sogar mehrzeilig.
Kommentare stehen nur im code und werden nicht ausgegeben.
Sie sind ganz hilfreich für eigene kleine Anmerkungen oder zum Korrekturlesen.  */

```
Code ist auch ein Block mit einem Shortcut (drei backticks). In einem Code-Block gibt es keine reservierten oder besonderen Zeichen:
= Auch die Umbruchregeln gelten nicht mehr. Alles wird so ausgegeben, wie geschrieben. Ansonsten könnte man ja keinen Typst-Code einbetten. Man nennt diesen Block deswegen auch 'code fence'.
```

```xml
<Language>
    <Capability>Man kann sogar die Sprache eines Code-Blocks angeben.</Capability>
    <Effect>Die Ausgabe wird dann je nach Sprache farbig formatiert.</Effect> 
</Language>
``` 

Das war's mit der ersten Seite und Vanilla-Typst-Features. Vielleicht noch yuletzt ein paar eingebaute Shortcuts für *Zeichenformate* $<-$ das ist Fett, dazu benutzen wir zwei Sternchen. _Das ist Doppelfett (Emphase)_ ('\_'). `code` -- das geht mit zwei Backticks ('\`'). Wenn wir ein Zeichen so benutzen wollen, ohne eine Formatierung auszulösen, benutzen wir als sog. _Escape-Zeichen_ einen Backslash $->$ ('\\'). Das bedeutet: wir meinen hier keine Formatierung, sondern wollen einfach das entsprechende Zeichen setzen, zB. \* oder \_ oder \\ oder wir setzen \\= am Zeilenbeginn. 

#pagebreak()

Mit der Zeile

```typst
#pagebreak()
```

haben wir schon die größte Neuerung  im Vergleich zu herkömmlichen Textformaten gesehen: in Typst vermischt sich unser Text mit Code, um das final ausgegbene Dokument genau nach unseren Anweisungen zu erstellen. 
Die Mögichkeit, mit Code zu arbeiten, macht Typst erst interessant.
Code erlaubt uns, das Dokument genauso einzurichten, wie wir es haben wollen.
Die Möglichkeit, Blöcke, Text und Seiten zu programmieren, gibt Typst einen viel größeren Funktionumfang als _WYSIWYG-Editoren_ wie Word. 