// Night Court design tokens — mirrors app/index.html and docs/brand-guide.md §8
export const colors = {
  night: '#14161C',
  panel: '#1A1D24',
  card: '#1E2128',
  card2: '#272B33',
  line: 'rgba(245,244,238,0.13)',
  text: '#F5F4EE',
  dim: 'rgba(245,244,238,0.62)',
  optic: '#C8F04A',
  opticDim: 'rgba(200,240,74,0.16)',
  ok: '#3DC96B',
  ink: '#14161C',
  danger: '#E15A72',
};

export const radii = { sm: 10, md: 14, lg: 18, xl: 20, pill: 999 };

export const type = {
  display: { fontWeight: '800', letterSpacing: -0.4, color: colors.text },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2.4,
    color: colors.dim,
  },
  body: { fontSize: 14, lineHeight: 20, color: colors.text },
  hint: { fontSize: 13, lineHeight: 19, color: colors.dim },
};

// Deterministic avatar tints derived from the brand family (see brand guide §3)
const AVATAR_TINTS = [
  ['#C8F04A', '#6E8F2C'],
  ['#8FD14F', '#2C6E4F'],
  ['#F2E86D', '#8F6E2C'],
  ['#B7E04A', '#3D6E2C'],
  ['#C8F04A', '#4A7A6E'],
  ['#E0D24A', '#6E4F2C'],
  ['#A3E04A', '#2C5A6E'],
  ['#C8F04A', '#7A5A2C'],
  ['#C9E858', '#3F5A20'],
  ['#EAF48F', '#5A6E2C'],
  ['#B0D93F', '#2C4A3D'],
  ['#DDE84A', '#4F3D6E'],
];

export function gradientFor(key) {
  let idx = 0;
  for (let i = 0; i < key.length; i += 1) idx = (idx + key.charCodeAt(i)) % AVATAR_TINTS.length;
  return AVATAR_TINTS[idx];
}

export function initials(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('');
}
