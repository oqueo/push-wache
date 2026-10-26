# push-wache - Anleitung

Version 0.1.0 · oQueo

push-wache hält gefährliche Befehle auf, bevor Claude Code sie ausführt. Es
prüft jeden Befehl, den Claude über das Bash-Werkzeug starten will, und lehnt
ihn mit einer verständlichen Begründung ab, wenn er einer dieser Regeln
widerspricht:

| Regel | Was gesperrt wird |
|---|---|
| **Push-Ziel** | `git push` an einen Host, der nicht auf Deiner Liste steht |
| **Hooks umgehen** | `git commit --no-verify`, `-n`, `git push --no-verify`, `git -c core.hooksPath=...` |
| **Force-Push** | `git push --force` und `-f` immer. Mit `--force-with-lease`, `+branch` oder Löschen nur auf geschützten Branches |
| **Breites rm -r** | `rm -r` auf `/`, `~`, `$HOME`, `.`, `..`, `*`, `/Users`, `/Users/NAME`, `/Volumes/NAME` und ähnliche Wurzeln |
| **Zugangsdaten** | bekannte Schlüssel und Tokens in der Befehlszeile (siehe unten) |

Die Meldung geht an Claude, und Claude kann den Befehl dann anders
formulieren oder bei Dir nachfragen. Der abgelehnte Befehl wird nicht ausgeführt.

## Was Du brauchst

- Claude Code (Terminal oder Desktop-App). Getestet mit Version 2.1.310.
  Ältere Versionen kennen die Plugin-Schnittstelle unter Umständen nicht.
- Für die Prüfung des Push-Ziels muss `git` auf dem Rechner installiert sein.
- Getestet unter macOS. Auf anderen Systemen sollte es genauso laufen, ist dort
  aber nicht geprüft.

## Installation in drei Schritten

### 1. ZIP entpacken und Ordner ablegen

Entpacke die ZIP-Datei. Du erhältst den Ordner `push-wache`. Lege ihn an einen
Platz, an dem er dauerhaft bleiben darf, zum Beispiel:

    ~/claude-mods/push-wache

Notiere Dir den vollständigen Pfad. In Schritt 3 brauchst Du ihn. Verschiebst
Du den Ordner später, muss der Pfad dort angepasst werden.

### 2. Zum Ausprobieren: einmalig im Terminal starten

    claude --plugin-dir ~/claude-mods/push-wache

Gefällt es Dir, mach weiter mit Schritt 3. Sonst schließt Du Claude Code, und
es bleibt nichts zurück.

### 3. Dauerhaft einschalten (auch für die Desktop-App)

Öffne die Datei `~/.claude/settings.json` und ergänze unter `env` diesen
Eintrag, mit Deinem vollständigen Pfad (ohne `~`, also zum Beispiel
`/Users/DEINNAME/claude-mods/push-wache`):

    {
      "env": {
        "CLAUDE_CODE_PLUGIN_DIRS": "/Users/DEINNAME/claude-mods/push-wache"
      }
    }

Gibt es in der Datei schon einen Block `env`, trägst Du die Zeile dort ein und
legst keinen zweiten an. Achte auf die Kommas zwischen den Einträgen.

Nutzt Du schon andere Plugins auf diese Weise, steht `CLAUDE_CODE_PLUGIN_DIRS`
bereits da. Dann hängst Du den neuen Pfad an den vorhandenen an, getrennt durch
einen Doppelpunkt (unter Windows durch ein Semikolon):

    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/DEINNAME/claude-mods/usage-led:/Users/DEINNAME/claude-mods/push-wache"

Danach Claude Code **neu starten**. In der Desktop-App heißt das: App beenden
und wieder öffnen.

## Das Push-Ziel festlegen

Ohne Einstellung prüft push-wache das Ziel nicht, die anderen Regeln gelten
trotzdem. Trag in `erlaubte_hosts` die Rechner ein, an die gepusht werden darf:

    git.example.com, *.intern.example.com

push-wache ermittelt das Ziel so: Steht im Befehl eine Adresse, nimmt es deren
Host. Steht ein Name wie `origin` darin, fragt es `git remote get-url --push`.
Fehlt beides, nimmt es das Push-Ziel des aktuellen Branches, sonst `origin`.
Dann vergleicht es den Host mit Deiner Liste. `*.example.com` passt auf alle
Unterdomänen. Ein Trockenlauf (`--dry-run`) wird nicht geprüft.

Ein Beispiel für die Meldung:

    push-wache: git push an "github.com" ist hier nicht erlaubt. Erlaubt: git.example.com.

## Zugangsdaten in der Befehlszeile

Erkannt werden diese Formen: Anthropic-Schlüssel (`sk-ant-...`), andere
`sk-`-Schlüssel, AWS-Zugangsschlüssel (`AKIA...`), GitHub-Token (`ghp_`, `gho_`,
`github_pat_`), Slack-Token (`xox...`), private Schlüssel (`-----BEGIN ... PRIVATE KEY-----`)
und JWT-Token. Zugangsdaten gehören in Umgebungsvariablen, einen
Passwortmanager oder eine geschützte Datei, nicht in den Befehl: Befehle landen
in Verläufen und Protokollen.

## Einstellungen

| Einstellung | Wirkung | Voreinstellung |
|---|---|---|
| `erlaubte_hosts` | erlaubte Push-Ziele, durch Komma getrennt | leer (keine Prüfung des Ziels) |
| `geschuetzte_branches` | Branches, die nie per Force-Push überschrieben oder gelöscht werden | `main,master` |
| `hooks_nicht_umgehen` | `--no-verify` und `core.hooksPath` sperren | an |
| `force_sperren` | Force-Push sperren | an |
| `rm_sperren` | breites `rm -r` sperren | an |
| `geheimnisse_sperren` | Zugangsdaten in Befehlen sperren | an |

### Einstellungen ändern

Die Einstellungen stehen im Konfigurationsmenü von Claude Code (`/config`) unter
dem Namen des Plugins. Alternativ trägst Du sie in `~/.claude/settings.json`
ein:

    {
      "pluginConfigs": {
        "push-wache": {
          "options": {
          "erlaubte_hosts": "git.example.com, *.intern.example.com",,
          "geschuetzte_branches": "main,master,release"
          }
        }
      }
    }

Nach einer Änderung lädt Claude Code das Plugin neu.

## Grenzen, die Du kennen solltest

push-wache liest die Befehlszeile. Es sieht deshalb nicht alles:

- Was ein **Skript** intern tut (`make deploy`, ein Shell-Skript, ein npm-Skript),
  sieht es nicht. Nur der Aufruf des Skripts ist sichtbar.
- Befehle in **Unterbefehlen** (`$(...)`, Backticks), Aliasse und Funktionen der
  Shell, `eval` mit zusammengesetztem Text sowie Befehle, die über andere
  Werkzeuge als Bash laufen (zum Beispiel eine Git-Erweiterung), erkennt es nicht
  zuverlässig. `bash -c "..."` prüft es mit.
- Ein bewusst verschleierter Befehl kommt durch. Es schützt vor **Versehen**, nicht
  vor Absicht.

Behalte deshalb Deine anderen Sicherungen: einen `pre-push`-Hook im Repository,
Rechte auf dem Server, Backups. push-wache ergänzt sie, ersetzt sie nicht.

## Wenn etwas nicht klappt

| Beobachtung | Ursache und Abhilfe |
|---|---|
| Ein harmloser Befehl wird gesperrt | Den Befehl genauer formulieren (zum Beispiel einen konkreten Pfad statt `.`) oder die Regel in den Einstellungen ausschalten |
| `git push` wird gesperrt, obwohl der Host stimmt | `erlaubte_hosts` ohne `https://` und ohne Port eintragen (nur der Hostname) und prüfen, welche Adresse `git remote get-url --push origin` liefert |
| Eine Meldung "die Prüfung ist fehlgeschlagen" | Ein Fehler im Plugin. Befehle mit `git` oder `rm` werden dann vorsichtshalber nicht ausgeführt, alle anderen laufen weiter |
| Nichts wird gesperrt | Claude Code neu starten, Pfad in `settings.json` prüfen (vollständig, ohne `~`) |

## Entfernen

1. Den Pfad von `push-wache` aus `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`
   streichen (steht nur dieses Plugin dort, den ganzen Eintrag löschen).
2. Claude Code neu starten.
3. Den Ordner `push-wache` löschen.

## Wichtig zu wissen

- push-wache ist ein unabhängiges Werkzeug von oQueo und steht in keiner
  Verbindung zu Anthropic. "Claude" und "Claude Code" sind Marken von Anthropic.
- Das Plugin wird ohne Gewähr bereitgestellt.
- push-wache ist **keine Sicherheitsgrenze**, sondern eine Vorsichtsmaßnahme gegen
  Versehen (siehe "Grenzen"). Wer böswillig umgehen will, kann das.

## Lizenz

push-wache steht unter der MIT-Lizenz (Datei `LICENSE`): Du darfst es frei nutzen,
kopieren, ändern und weitergeben, solange der Urheberrechtsvermerk erhalten
bleibt. Name, Marken, Logos und Corporate Design von oQueo sind von der Lizenz
ausgenommen, Einzelheiten stehen im Zusatz am Ende der `LICENSE`.

Copyright (c) 2026 [Robert-P. Pelikan, oQueo](https://oqueo.io)
