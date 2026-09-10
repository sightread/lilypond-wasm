\version "2.26.0"
% Keep allocated Scheme values live across repeated collections. The GC must
% see both Guile roots and pointers spilled from WebAssembly locals.
#(define retained (map (lambda (i) (cons i (make-string 512 #\x))) (iota 20000)))
#(do ((i 0 (+ i 1))) ((= i 12))
   (let ((scratch (make-vector 20000 retained)))
     (gc)
     (if (not (= (car (list-ref (vector-ref scratch 12345) 19999)) 19999))
         (error "WASM GC lost a live object"))))
\score {
  \new Staff \relative c' { \repeat unfold 128 { c8 d e f g a b c } }
  \midi { \tempo 4 = 120 }
}
