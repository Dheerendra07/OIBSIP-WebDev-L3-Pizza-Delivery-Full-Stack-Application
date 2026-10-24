import { useId } from 'react';

const VARIANTS = {
  tomato: {
    tomatoes: [[98, 92, 15], [151, 78, 14], [196, 118, 15], [171, 169, 14], [112, 184, 14], [72, 139, 13]],
    peppers: [],
    mushrooms: [],
    olives: [],
    herbs: [[126, 111, -28], [177, 108, 34], [132, 158, 18], [88, 157, -42], [194, 150, 25]],
  },
  green: {
    tomatoes: [[106, 110, 10], [174, 151, 10]],
    peppers: [[84, 119, 13, '#5e7a42'], [144, 91, 14, '#6c8d46'], [192, 131, 14, '#678943'], [119, 174, 13, '#77974e'], [162, 188, 10, '#65823e']],
    mushrooms: [[146, 122, -14], [87, 165, 23], [187, 91, -20]],
    olives: [[110, 83, 6], [168, 115, 6], [145, 164, 6]],
    herbs: [[123, 100, 30], [187, 162, -40], [103, 143, -12]],
  },
  orange: {
    tomatoes: [],
    peppers: [[103, 91, 12, '#6e8847'], [176, 103, 12, '#638140'], [130, 156, 13, '#708a48'], [199, 158, 11, '#66803c']],
    mushrooms: [],
    olives: [],
    herbs: [[100, 158, -30], [162, 128, 17]],
    pepperoni: [[91, 129, 15], [142, 79, 14], [183, 119, 15], [150, 151, 14], [105, 183, 13], [197, 177, 12], [171, 197, 10]],
  },
  cream: {
    tomatoes: [[94, 124, 10], [178, 169, 10]],
    peppers: [],
    mushrooms: [[112, 84, -22], [161, 97, 18], [192, 130, -13], [132, 154, 25], [88, 176, -5], [175, 193, -18]],
    olives: [[135, 88, 6], [185, 91, 6], [115, 145, 6], [162, 136, 6], [197, 157, 6]],
    herbs: [[122, 123, 17], [155, 181, -30], [91, 149, -16]],
  },
};

const PALETTES = {
  tomato: {
    crust: ['#f7d39b', '#e7b16b', '#b87336'],
    cheese: ['#fff0ba', '#f0ca66', '#dda847'],
    outerRing: '#edc06e',
    cheeseRim: '#f7dc8b',
    tomato: ['#f47751', '#d94d31', '#ad3024'],
    pepperoni: ['#d95c3e', '#a83225', '#76251d'],
  },
  green: {
    crust: ['#e9d2a5', '#d1ab70', '#a87542'],
    cheese: ['#f9e7a8', '#e0d78a', '#bdc17a'],
    outerRing: '#d8d99a',
    cheeseRim: '#e7e4a9',
    tomato: ['#ef8660', '#d65a3d', '#9e3629'],
    pepperoni: ['#cd6948', '#963e2b', '#6a3025'],
  },
  orange: {
    crust: ['#e8b887', '#cf884e', '#8f4b27'],
    cheese: ['#f8ce83', '#eea34f', '#c95c2e'],
    outerRing: '#ef9c43',
    cheeseRim: '#f4c26a',
    tomato: ['#f36b42', '#d73b27', '#9f241b'],
    pepperoni: ['#d95037', '#a1261c', '#681f18'],
  },
  cream: {
    crust: ['#e2d1ad', '#c6ab7e', '#92704d'],
    cheese: ['#fff9e7', '#f1e3c4', '#cebe9c'],
    outerRing: '#d8c8a8',
    cheeseRim: '#eee0be',
    tomato: ['#f18b69', '#d96a4a', '#a34531'],
    pepperoni: ['#bd6d54', '#8f4435', '#5f3028'],
  },
};

const CRUST_MARKS = [
  [111, 45, 4], [158, 39, 3], [197, 58, 4], [225, 91, 3],
  [231, 143, 4], [213, 188, 3], [185, 222, 4], [139, 237, 3],
  [95, 224, 4], [61, 197, 3], [39, 153, 4], [54, 103, 3],
  [78, 68, 4], [133, 35, 2], [215, 116, 2], [75, 187, 2],
];

function PizzaArtwork({ variant = 'tomato', className = '' }) {
  const rawId = useId();
  const id = rawId.replace(/:/g, '');
  const toppings = VARIANTS[variant] || VARIANTS.tomato;
  const palette = PALETTES[variant] || PALETTES.tomato;
  const cssClass = ['pizza-artwork', className].filter(Boolean).join(' ');

  return (
    <svg className={cssClass} viewBox="0 0 270 270" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id + '-crust'} cx="34%" cy="25%" r="78%">
          <stop offset="0%" stopColor={palette.crust[0]} />
          <stop offset="57%" stopColor={palette.crust[1]} />
          <stop offset="84%" stopColor={palette.crust[2]} />
          <stop offset="100%" stopColor={palette.crust[2]} />
        </radialGradient>
        <radialGradient id={id + '-cheese'} cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor={palette.cheese[0]} />
          <stop offset="68%" stopColor={palette.cheese[1]} />
          <stop offset="100%" stopColor={palette.cheese[2]} />
        </radialGradient>
        <radialGradient id={id + '-tomato'} cx="32%" cy="28%" r="75%">
          <stop offset="0%" stopColor={palette.tomato[0]} />
          <stop offset="62%" stopColor={palette.tomato[1]} />
          <stop offset="100%" stopColor={palette.tomato[2]} />
        </radialGradient>
        <radialGradient id={id + '-pepperoni'} cx="35%" cy="25%" r="75%">
          <stop offset="0%" stopColor={palette.pepperoni[0]} />
          <stop offset="75%" stopColor={palette.pepperoni[1]} />
          <stop offset="100%" stopColor={palette.pepperoni[2]} />
        </radialGradient>
        <clipPath id={id + '-surface'}>
          <circle cx="135" cy="132" r="96" />
        </clipPath>
      </defs>

      <ellipse cx="138" cy="150" rx="106" ry="106" fill="#4f2c1b" opacity=".13" />
      <circle cx="135" cy="132" r="111" fill={'url(#' + id + '-crust)'} stroke="#b8793d" strokeWidth="2.5" />
      <circle cx="135" cy="132" r="101" fill={palette.outerRing} opacity=".8" />
      <circle cx="135" cy="132" r="96" fill={'url(#' + id + '-cheese)'} stroke={palette.cheeseRim} strokeWidth="1.5" />

      {CRUST_MARKS.map(([x, y, r], index) => (
        <g key={'crust-' + index}>
          <circle cx={x} cy={y} r={r + 1.5} fill="#9e5c2d" opacity=".2" />
          <circle cx={x} cy={y} r={r} fill={index % 3 === 0 ? '#b76c34' : '#fff0bb'} opacity={index % 3 === 0 ? '.28' : '.46'} />
        </g>
      ))}

      <g clipPath={'url(#' + id + '-surface)'}>
        <path d="M135 132 L135 36 M135 132 L202 61 M135 132 L231 132 M135 132 L204 202 M135 132 L135 228 M135 132 L66 202 M135 132 L39 132 M135 132 L66 63" fill="none" stroke="#dcae50" strokeWidth="1.3" opacity=".22" />

        {Array.from({ length: 18 }, (_, index) => {
          const x = 70 + ((index * 37) % 130);
          const y = 63 + ((index * 29) % 137);
          const radius = 1.6 + (index % 3);
          return <circle key={'bubble-' + index} cx={x} cy={y} r={radius} fill="#fff0ae" opacity=".43" />;
        })}

        {toppings.pepperoni?.map(([x, y, r], index) => (
          <g key={'pepperoni-' + index}>
            <circle cx={x} cy={y + 2} r={r + 1} fill="#8d2b21" opacity=".2" />
            <circle cx={x} cy={y} r={r} fill={'url(#' + id + '-pepperoni)'} stroke="#922b22" strokeWidth="1.2" />
            <circle cx={x - 4} cy={y - 4} r={r * .24} fill="#f5a078" opacity=".7" />
            <circle cx={x + 4} cy={y + 3} r={r * .14} fill="#f2bb83" opacity=".65" />
          </g>
        ))}

        {toppings.tomatoes.map(([x, y, r], index) => (
          <g key={'tomato-' + index}>
            <circle cx={x} cy={y + 2} r={r + 1} fill="#9d3525" opacity=".18" />
            <circle cx={x} cy={y} r={r} fill={'url(#' + id + '-tomato)'} stroke="#b33b2a" strokeWidth="1" />
            <circle cx={x} cy={y} r={r * .57} fill="#f28a5e" stroke="#f8bb82" strokeWidth="1.5" />
            <circle cx={x - 3} cy={y - 3} r="1.8" fill="#fff1b9" opacity=".8" />
            <circle cx={x + 4} cy={y + 2} r="1.5" fill="#fff1b9" opacity=".8" />
          </g>
        ))}

        {toppings.peppers.map(([x, y, r, color], index) => (
          <g key={'pepper-' + index}>
            <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth="7" />
            <circle cx={x} cy={y} r={r - 3.5} fill="none" stroke="#c0d184" strokeWidth="1.2" opacity=".85" />
            <path d={'M' + (x - r * .42) + ' ' + (y - r * .55) + ' Q' + x + ' ' + (y - r * 1.15) + ' ' + (x + r * .55) + ' ' + (y - r * .2)} fill="none" stroke="#f2e4a3" strokeWidth="1.3" strokeLinecap="round" opacity=".7" />
          </g>
        ))}

        {toppings.mushrooms.map(([x, y, angle], index) => (
          <g key={'mushroom-' + index} transform={'translate(' + x + ' ' + y + ') rotate(' + angle + ')'}>
            <path d="M-13 3 C-15 -6 -8 -14 0 -14 C9 -14 15 -7 14 3 Z" fill="#bba083" stroke="#8f745a" strokeWidth="1.3" />
            <path d="M-8 1 L-5 6 M0 -1 L1 6 M8 1 L6 6" stroke="#ead5b1" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M-7 4 L-5 12 Q0 16 5 12 L7 4" fill="#f0d9ae" stroke="#b79a76" strokeWidth="1" />
            <path d="M-8 -4 Q0 -12 8 -4" fill="none" stroke="#fff0ce" strokeWidth="1.4" strokeLinecap="round" opacity=".8" />
          </g>
        ))}

        {toppings.olives.map(([x, y, r], index) => (
          <g key={'olive-' + index}>
            <ellipse cx={x} cy={y + 1} rx={r + 1} ry={r} fill="#6b4b2f" opacity=".18" />
            <circle cx={x} cy={y} r={r} fill="#3e4230" stroke="#666747" strokeWidth="1.4" />
            <circle cx={x} cy={y} r={r * .42} fill="#f1c96b" />
            <circle cx={x - 2} cy={y - 2} r="1.2" fill="#f7edbd" />
          </g>
        ))}

        {toppings.herbs.map(([x, y, angle], index) => (
          <g key={'herb-' + index} transform={'translate(' + x + ' ' + y + ') rotate(' + angle + ')'}>
            <path d="M0 0 C-5 -7 -5 -17 0 -23 C5 -17 6 -7 0 0 Z" fill="#526d3c" stroke="#415a31" strokeWidth=".8" />
            <path d="M0 -1 L0 -19" fill="none" stroke="#a1b879" strokeWidth="1.1" strokeLinecap="round" />
            <path d="M0 -8 L-3 -12 M0 -12 L3 -16" fill="none" stroke="#a1b879" strokeWidth=".8" strokeLinecap="round" />
          </g>
        ))}

        <path d="M73 105 Q96 73 124 76" fill="none" stroke="#fff1c4" strokeWidth="3" strokeLinecap="round" opacity=".26" />
      </g>
      <circle cx="135" cy="132" r="96" fill="none" stroke={palette.cheeseRim} strokeWidth="1.5" opacity=".7" />
    </svg>
  );
}

export default PizzaArtwork;
