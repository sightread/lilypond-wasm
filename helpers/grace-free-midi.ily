\version "2.26.0"

%% Copyright (C) 2026 Jake Fried. GPL-3.0-or-later; see the LICENSE beside this file.
%%
%% grace-free-midi.ily — render a score's MIDI with repeats unfolded and grace notes removed,
%% discarding whatever \layout or \midi output the source itself declares.
%%
%%   lilypond -dinclude-settings=grace-free-midi.ily --formats=midi -o out/<stem> <file>.ly
%%
%% writes `out/<stem>.midi`. Grace-note timing in LilyPond's MIDI is borrowed from the
%% surrounding music, so recovering the timing as if grace notes were never written means
%% removing them from the music before the timing translator ever sees them, not filtering
%% MIDI events after the fact. Useful on its own as a click-track-style render, and as a
%% grace-free playback reference to compare some other rendering of the same source against.

#(use-modules (srfi srfi-1))

%% A read-only walk: music-map rewrites the tree as it goes, and a rewritten \repeat unfold
%% no longer unfolds ("Moment is not increasing" in the MIDI pass).
#(define (gfm-music-has-notes? music)
   (and (ly:music? music)
        (or (music-is-of-type? music 'note-event)
            (let ((element (ly:music-property music 'element)))
              (and (ly:music? element) (gfm-music-has-notes? element)))
            (any gfm-music-has-notes? (ly:music-property music 'elements '())))))

%% ly:book-scores and ly:book-book-parts hand back their lists newest first, so both are
%% reversed here to read the file in its written order.
#(define (gfm-scores-of-book book)
   (append (reverse (filter ly:score? (ly:book-scores book)))
           (append-map gfm-scores-of-book (reverse (ly:book-book-parts book)))))

%% A file can hand back several books; the first one with a score that has notes is the piece.
#(define (gfm-book-handler book)
   (let* ((scores (gfm-scores-of-book book))
          (score (find (lambda (s) (gfm-music-has-notes? (ly:score-music s))) scores)))
     (when score
       (let* ((unfolded (unfold-repeats '() (ly:music-deep-copy (ly:score-music score))))
              (filtered (music-filter (lambda (m) (not (music-is-of-type? m 'grace-music)))
                                       unfolded))
              ;; scorify-music, not ly:make-score: \score runs the top-level music functions
              ;; on its music, and the unfolded copy needs that pass again or its \repeat
              ;; unfold blocks stop iterating.
              (midi (scorify-music filtered))
              (out (ly:make-book (ly:parser-lookup '$defaultpaper)
                                 (ly:parser-lookup '$defaultheader))))
         (ly:score-add-output-def! midi (ly:output-def-clone (ly:parser-lookup '$defaultmidi)))
         (ly:book-add-score! out midi)
         (print-book-with-defaults out)))))

#(define toplevel-book-handler gfm-book-handler)
#(define default-toplevel-book-handler gfm-book-handler)
