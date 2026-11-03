# Word Pocket

A pocket dictionary for your phone, for the English words you hear in
movies, series, songs and videos. It goes with Word Log on the computer.

- **Look up**: type the word, or tap the microphone and say it. While you
  type, it suggests spellings; if a word is not found, it offers words that
  sound like it (for a word you heard but cannot spell). You get the Spanish,
  the English meanings by kind (noun, verb...) with examples, and the sound.
- **🎬 What are you watching?**: tap it once and every word you save is
  kept with that movie or show. "What did they say?" keeps the line you heard.
- **Similar words** on each card, your **recent searches** under the search
  box, and a × to clear it.
- **My words**: grouped by movie/show or by day, with how far along you are
  (new · learning · mastered) and a level line on each word.
- **Practice**, four ways:
  - **Flashcards**: tap to turn the card, swipe right if you know the word,
    left to see it again. Spaced repetition brings each word back after 1, 3,
    7, 14 and 30 days; the number on the Practice tab is what is due today.
  - **Quiz**: eight questions (meaning, word, the line you heard, listening).
  - **Listen**: hear the word, find it.
  - **Speed round**: as many as you can in 60 seconds. Beat your record.
  - **Spell it**: see the Spanish, type the English (first letter and length
    as a hint; one slip in a long word counts as almost right).
- **🔥 Streak**: the days in a row you saved or practised a word.
- **The ring** at the top is today's goal (change it in My words → Settings).
- **Several dictionaries, one clear answer.** No AI, no account; only the
  word you look up is sent to these free services:
  - **Datamuse**: short definitions with labels (informal, finance...), the
    kinds of word in order of use, and how common the word is.
  - **Wiktionary**: an example and the Spanish for each meaning. How many
    languages translate a meaning shows how much it is used, so the most
    used meanings come first.
  - **dictionaryapi.dev**: the pronunciation and a recording.
  - **MyMemory**: the Spanish, only when Wiktionary has none.
  Old, rare and dialect meanings, and names of people and places, are left
  out; specialist meanings (finance, computing...) go last.
- Works **without internet** once opened: a word saved offline gets its
  meaning when the phone is online again.

## Settings (the gear) and your words

Daily goal, sounds, vibration, what you are watching, and:

- **Save a backup**: one file with all your words (and your progress), to
  keep safe or to move to a new phone. **Bring words in** reads it back,
  adding only the words you do not have yet.
- **I use Word Log on my computer**: shows "Send to Word Log". It is on for
  the phone that already had words; a friend opening the app fresh does not
  see it. The first time anyone opens the app, a short welcome explains it
  and how to put it on the home screen.

## Your words go to Word Log

In **My words**, press **Send**. Your phone's share menu opens: choose
**OneDrive** and save the file in the **Word Pocket** folder (the first time,
find it at the top level of your OneDrive; after that OneDrive usually
remembers it). The next time Word Log opens its Dictionary on the computer,
the words appear under **Saved while reading**, ready to add.

Your words are stored only on your phone. Sending them to Word Log also keeps
a copy in OneDrive.

## Where it lives

The code is in the public GitHub repository `ESEMILALO/word-pocket` (only the
app's code: your words are never in it). It is published as a website at
your own address, which updates by itself whenever the repository changes:

**https://esemilalo.github.io/word-pocket/** (GitHub Pages, free)

## On your phone (once)

- **iPhone (Safari)**: open the address above, tap **Share** → **Add to
  Home Screen**.
- **Android (Chrome)**: open the address, tap **⋮** → **Install app** (or
  **Add to Home screen**).

It then opens from its own icon, full screen, like any other app.

## Copyright and license

© 2026 Eduardo Cruz. Word Pocket is free to use, study, change and share
for **non-commercial** purposes under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md). It may **not** be sold
or used in any paid or commercial product. All other rights are reserved.

## Changing it

Edit the files here, then commit and push to `word-pocket`: GitHub Pages
publishes the new version within a minute or two, and the phone gets it the next time the app
opens online. `make_icons.py` redraws the icons.
