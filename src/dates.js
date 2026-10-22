// Даты храним строками YYYY-MM-DD (календарные дни, без учёта выходных — допущение MVP).

export function today() {
  if (process.env.TODAY) return process.env.TODAY;
  const d = new Date();
  return fmt(d);
}

export function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export function diffDays(a, b) {
  // a - b в днях
  return Math.round((parse(a) - parse(b)) / 86400000);
}

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s));
}

export function ru(s) {
  if (!s) return '—';
  const [, m, d] = s.split('-');
  return `${d}.${m}`;
}
