// Tiny exact arithmetic evaluator (no eval). Grammar: expr := term (('+'|'-') term)*,
// term := factor (('*'|'/') factor)*, factor := number | '(' expr ')' | '-' factor.
export function evaluate(src: string): number {
  const s = src.replace(/,/g, '').replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  let i = 0;
  const peek = () => s[i];
  function num(): number {
    const m = /^\d+(\.\d+)?(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) throw new Error(`Bad number at position ${i} in "${src}"`);
    i += m[0].length;
    let v = parseFloat(m[0]);
    if (peek() === '%') { i++; v = v / 100; }
    return v;
  }
  function factor(): number {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('Missing )'); i++; return v; }
    return num();
  }
  function term(): number {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++]; const r = factor();
      if (op === '/' && r === 0) throw new Error('Division by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr(): number {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  const v = expr();
  if (i !== s.length) throw new Error(`Unexpected "${s.slice(i)}" in "${src}"`);
  return Math.round(v * 1e6) / 1e6;
}
