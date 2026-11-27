import { describe, it, expect } from 'vitest';
import { evaluate } from './calc';
describe('calculate', () => {
  it('handles precedence and parentheses', () => { expect(evaluate('(93000+59000)/274000*100')).toBeCloseTo(55.474453, 5); });
  it('handles commas, unary minus, percent', () => { expect(evaluate('-2,500 + 10%*1000')).toBe(-2400); });
  it('rejects code', () => { expect(() => evaluate('process.exit()')).toThrow(); });
  it('rejects division by zero', () => { expect(() => evaluate('1/0')).toThrow(); });
});
