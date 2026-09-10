\version "2.26.0"
\header { title = "LilyPond in WebAssembly" }
\score {
  \new Staff \relative c' { \time 4/4 c4 d e f | g2 g | a4 a a a | g1 }
  \layout { }
  \midi { \tempo 4 = 120 }
}
