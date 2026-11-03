# Word Pocket

A pocket dictionary for your phone, for the English words you hear in
movies, series, songs and videos. It goes with Word Log on the computer.

- **Look up**: type the word, or tap the microphone and say it. While you
  type, it suggests spellings; if a word is not found, it offers words that
  sound like it (for a word you heard but cannot spell). You get the Spanish,
  the English meanings by kind (noun, verb...) with examples, and the sound.
- **🎬 What are you watching?**: tap it once and every word you save is
  kept with that movie or show. "What did they say?" keeps the line you heard.
- **My words**: grouped by movie/show or by day. Tap a word to open it.
- **Practice**, four ways:
  - **Flashcards**: tap to turn the card, swipe right if you know the word,
    left to see it again. Spaced repetition brings each word back after 1, 3,
    7, 14 and 30 days; the number on the Practice tab is what is due today.
  - **Quiz**: eight questions (meaning, word, the line you heard, listening).
  - **Listen**: hear the word, find it.
  - **Speed round**: as many as you can in 60 seconds. Beat your record.
- **🔥 Streak**: the days in a row you saved or practised a word.
- **The ring** at the top is today's goal (change it in My words → Settings).
- **No AI**, no account. Meanings come from free services (dictionaryapi.dev,
  MyMemory, Datamuse); only the word you look up is sent to them.
- Works **without internet** once opened: a word saved offline gets its
  meaning when the phone is online again.

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

## Changing it

Edit the files here, then commit and push to `word-pocket`: GitHub Pages
publishes the new version within a minute or two, and the phone gets it the next time the app
opens online. `make_icons.py` redraws the icons.
