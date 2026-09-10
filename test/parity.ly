\version "2.26.0"
\header { title = "WASM parity: repeats, voices, tuplets and ties" }
upper = \relative c'' {
  \key g \major \time 4/4
  \repeat volta 2 {
    << { g2~ g4 a } \\ { e4 d c b } >> |
    \tuplet 3/2 { b8 c d } e4 \grace { fis16 g } fis4 e |
  }
  \alternative { { d1 } { <g b d>1\fermata } }
}
lower = \relative c {
  \clef bass \key g \major \time 4/4
  \repeat volta 2 { <g d'>2 <c e> | <d fis>2 <a c> | }
  \alternative { { <g b>1 } { <g d'>1 } }
}
\score {
  \new PianoStaff << \new Staff \upper \new Staff \lower >>
  \layout { }
  \midi { \tempo 4 = 92 }
}
