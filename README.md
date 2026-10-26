# push-wache

Ein Plugin für Claude Code: prüft Bash-Befehle, bevor sie laufen, und lehnt
gefährliche ab (git push an fremde Hosts, --no-verify, Force-Push auf
geschützte Branches, rm -r auf breite Pfade, Zugangsdaten in der Befehlszeile).

Die Anleitung für Nutzer steht in `ANLEITUNG.md`.

## Aufbau

- `.claude-plugin/plugin.json`: Manifest mit den Einstellungen (`userConfig`)
- `hooks/hooks.json`: nennt das Modul
- `hooks/register.ts`: der Hook auf `tool.call` für Bash. `tokenize` zerlegt die
  Befehlszeile, `judge` prüft Segment für Segment (Git, rm, Zugangsdaten)
- `hooks/register.test.ts`: Tests (nur im Quellordner, nicht in der ZIP)

Der Hook ist mit `.catch` abgesichert: schlägt die Prüfung fehl, werden Befehle mit
`git` oder `rm` nicht ausgeführt, alle anderen laufen weiter.

## Prüfen

    claude plugin validate .
    claude plugin test .

## Lizenz

MIT-Lizenz, siehe `LICENSE`. Name, Marken, Logos und Corporate Design von oQueo
sind von der Lizenz ausgenommen (Zusatz am Ende der `LICENSE`).

Copyright (c) 2026 [Robert-P. Pelikan, oQueo](https://oqueo.io)
