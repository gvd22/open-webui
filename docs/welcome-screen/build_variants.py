# Builds variants.html (run: python3 docs/welcome-screen/build_variants.py): 10 welcome-screen variants side by side with one shared timeline.
# The background CSS is taken verbatim from WelcomeBackground.svelte.
import re, json, pathlib

SRC = (pathlib.Path(__file__).resolve().parents[2] / 'src/lib/components/chat/'
       'Placeholder/WelcomeBackground.svelte').read_text()
css = SRC[SRC.index('<style>') + 7:SRC.index('</style>')]
css = re.sub(r':global\(([^)]*)\)', r'\1', css)
groups = {'warm': ['red-1', 'red-2'], 'cool': ['blue-1', 'blue-2', 'blue-3', 'blue-4', 'blue-5']}

def layer(extra=''):
    sides = ''.join(
        f'<div class="side {side}">' + ''.join(
            f'<div class="wander {b}"><div class="wander-y"><div class="blob"></div></div></div>' for b in blobs
        ) + '</div>' for side, blobs in groups.items())
    return f'<div class="layer{extra}"><div class="cloud">{sides}</div></div>'

BG = ('<div class="welcome-bg" style="--welcome-clock:0s;--welcome-fade:1500ms;--welcome-fade-delay:0ms">'
      + layer() + layer(' grid') + '<div class="dither"></div></div>')

# Round 2: everything based on F (bigger, softer). Opacity is a factor on the theme
# defaults (F = 0.81), so dark/OLED keep their own levels. Layer vars change the mask.
OVAL = 'radial-gradient(ellipse 46% 62% at 50% 58%, black 40%, transparent 100%)'
SOFT = 'linear-gradient(to right, transparent 2%, black 32%, black 68%, transparent 98%)'
CALM = {'--wander-amount': '0.5', '--cloud-move-amount': '0.6'}
ROUND = {'--breathe-amount': '0.4', '--cloud-shape-amount': '0.5'}
F = {'--blob-scale': '1.3'}
VARIANTS = [
    ('1 · F wie bisher', 0.81, F, {}),
    ('2 · F + ovale Maske (keine Ecken)', 0.81, F, {'--limit-x': OVAL}),
    ('3 · F + weicherer Rand', 0.81, F, {'--limit-x': SOFT}),
    ('4 · F + weniger Ausreisser', 0.81, {**F, **CALM}, {}),
    ('5 · F + rundere Formen', 0.81, {**F, **ROUND}, {}),
    ('6 · oval + weniger Ausreisser + rund', 0.81, {**F, **CALM, **ROUND}, {'--limit-x': OVAL}),
    ('7 · oval + enger zusammen', 0.81, {**F, '--orbit-rx': '9cqw', '--orbit-ry': '6cqh', '--wander-amount': '0.6'}, {'--limit-x': OVAL}),
    ('8 · oval + ruhiger', 0.81, {**F, **CALM, '--wander-time': '1.5', '--breathe-time': '1.5', '--orbit-duration': '200s'}, {'--limit-x': OVAL}),
    ('9 · oval + etwas kleiner + weniger Ausreisser', 0.85, {'--blob-scale': '1.15', **CALM}, {'--limit-x': OVAL}),
    ('10 · oval + rund + etwas kräftiger', 0.92, {**F, **ROUND}, {'--limit-x': OVAL}),
]
THEME_OPACITY = {'': 0.8, 'html.dark ': 0.36, 'html.dark:not(.sds) ': 0.26}

def desc(f, vars_, layer):
    parts = [f'Stärke ×{f}'] + [f'{k[2:]} {v}' for k, v in vars_.items()]
    if layer.get('--limit-x') == OVAL: parts.append('ovale Maske')
    if layer.get('--limit-x') == SOFT: parts.append('weicher Rand')
    return ', '.join(parts)

variant_css = ''
for i, (_, f, vars_, layer) in enumerate(VARIANTS):
    cell = f'.cell[data-i="{i}"]'
    variant_css += f'{cell} .welcome-bg{{' + ';'.join(f'{k}:{v}' for k, v in vars_.items()) + '}\n'
    for theme, base in THEME_OPACITY.items():
        variant_css += f'{theme}{cell} .welcome-bg{{--welcome-opacity:{round(base * f, 3)}}}\n'
    if layer:
        variant_css += f'{cell} .layer{{' + ';'.join(f'{k}:{v}' for k, v in layer.items()) + '}\n'

CONTENT = '''<div class="content">
  <h1 class="c-greet">Womit fangen wir an?</h1>
  <div class="c-input"><div class="ph">Wie kann ich Ihnen heute helfen?</div>
    <div class="row"><span>＋</span><span class="model">Wählen Sie ein Modell ⌄</span><span class="send">●</span></div></div>
  <div class="c-sugg">
    <div class="pill" data-welcome-avoid>⚡ VORGESCHLAGEN</div>
    <ul>
      <li data-welcome-avoid><b>Tell me a fun fact</b><span>about the Roman Empire</span></li>
      <li data-welcome-avoid><b>Help me study</b><span>vocabulary for a college entrance exam</span></li>
      <li data-welcome-avoid><b>Overcome procrastination</b><span>give me tips</span></li>
    </ul>
  </div>
</div>'''

tiles = ''
for i, (name, f, vars_, layer) in enumerate(VARIANTS):
    d = desc(f, vars_, layer)
    tiles += f'''<div class="cell" data-i="{i}">
  <div class="frame"><div class="tile">{BG}{CONTENT}</div></div>
  <div class="caption"><div><b>{name}</b><div class="desc">{d}</div></div>
    <div class="stars">{''.join(f'<button data-v="{v}">{v}</button>' for v in range(1, 6))}</div></div>
</div>'''

PAGE = '''<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Welcome-Varianten</title>
<style>
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f3f4f6;color:#111}
html.dark body{background:#0b0b0b;color:#eee}
.bar{position:sticky;top:0;z-index:100;display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:10px 16px;background:#fff;border-bottom:1px solid #ddd;font-size:13px}
html.dark .bar{background:#151515;border-color:#333}
.bar button{padding:3px 10px;border:1px solid #bbb;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.bar button.on{background:#2563eb;color:#fff;border-color:#2563eb}
.board{display:flex;flex-wrap:wrap;gap:16px;padding:16px}
.frame{width:calc(1300px*var(--s));height:calc(850px*var(--s));overflow:hidden;border-radius:10px;box-shadow:0 1px 3px #0003}
.tile{position:relative;width:1300px;height:850px;transform:scale(var(--s));transform-origin:top left;background:#fff;overflow:hidden;font-size:16px}
html.dark.sds .tile{background:#171717}
html.dark:not(.sds) .tile{background:#000}
.caption{display:flex;justify-content:space-between;gap:8px;width:calc(1300px*var(--s));font-size:12px;padding-top:6px}
.desc{color:#666;max-width:calc(1300px*var(--s) - 150px)}
html.dark .desc{color:#999}
.stars button{width:24px;height:24px;border:1px solid #bbb;border-radius:5px;background:transparent;color:inherit;cursor:pointer}
.stars button.on{background:#f59e0b;border-color:#f59e0b;color:#000}
.content{position:relative;z-index:10;display:flex;flex-direction:column;align-items:center;padding-top:250px;color:#1f2937}
html.dark .content{color:#f3f4f6}
.c-greet{margin:0 0 12px;font-size:28px;font-weight:400;line-height:36px}
.c-input{width:768px;box-sizing:border-box;border:1px solid #e5e7eb;border-radius:24px;background:#fff;box-shadow:0 1px 2px #0001;padding:16px 18px;color:#6b7280}
html.dark .c-input{background:#262626;border-color:#333;color:#9ca3af}
.c-input .row{display:flex;gap:16px;margin-top:22px;align-items:center}.c-input .model{margin-left:auto}
.c-sugg{width:672px;margin-top:20px}
.pill{display:inline-block;font-size:12px;letter-spacing:.04em;padding:2px 8px;border-radius:99px;background:#ffffffd9;color:#4b5563;margin-bottom:6px}
html.dark .pill{background:#262626d9;color:#9ca3af}
.c-sugg ul{list-style:none;margin:0;padding:4px;display:flex;flex-direction:column;gap:8px}
.c-sugg li{display:flex;flex-direction:column;padding:10px 16px;border-radius:12px;background:#fff;border:1px solid #f3f4f6;box-shadow:0 1px 2px #0001;font-size:14px}
.c-sugg li span{font-size:12px;color:#4b5563}
html.dark .c-sugg li{background:#262626;border-color:#2d2d2d}html.dark .c-sugg li span{color:#9ca3af}
/* ---- WelcomeBackground.svelte styles ---- */
''' + css + '''\n/* ---- variants ---- */\n''' + variant_css + '''
</style></head><body>
<div class="bar">
  <b>Welcome-Varianten</b>
  <button id="play">Pause</button>
  <label>Speed <input id="speed" type="range" min="0.1" max="20" step="0.1" value="1"> <span id="speedv">1.0×</span></label>
  <label>Zeit <input id="time" type="range" min="0" max="300" step="0.5" value="0" style="width:280px"> <span id="timev">0.0 s</span></label>
  <span>Theme <button data-theme="light" class="on">Light</button> <button data-theme="dark">Dark</button> <button data-theme="oled">OLED</button></span>
  <label>Grösse <input id="scale" type="range" min="0.2" max="0.7" step="0.01" value="0.34"></label>
  <button id="copy">Bewertungen kopieren</button>
</div>
<div class="board" id="board">''' + tiles + '''</div>
<script>
const VARIANTS = ''' + json.dumps([(n, desc(f, v, l)) for n, f, v, l in VARIANTS]) + ''';
const root = document.documentElement;
const grid = document.getElementById('board');
let scale = 0.34, playing = true, speed = 1;
grid.style.setProperty('--s', scale);
const anims = () => document.querySelectorAll('.welcome-bg').length ? [...document.querySelectorAll('.welcome-bg')].flatMap(b => b.getAnimations({subtree: true})) : [];
const loopAnim = () => anims().find(a => a.effect && a.effect.getTiming().iterations === Infinity);

// timeline (same for all tiles, every variant starts at 0 s)
const playBtn = document.getElementById('play'), time = document.getElementById('time');
playBtn.onclick = () => { playing = !playing; anims().forEach(a => { a.playbackRate = speed; playing ? a.play() : a.pause(); }); playBtn.textContent = playing ? 'Pause' : 'Play'; };
document.getElementById('speed').oninput = e => { speed = +e.target.value; document.getElementById('speedv').textContent = speed.toFixed(1) + '×'; anims().forEach(a => a.playbackRate = speed); };
time.oninput = () => { anims().forEach(a => { a.currentTime = time.value * 1000; if (!playing) a.pause(); }); document.getElementById('timev').textContent = (+time.value).toFixed(1) + ' s'; };
setInterval(() => { const a = loopAnim(); if (playing && a && typeof a.currentTime === 'number') { time.value = a.currentTime / 1000; document.getElementById('timev').textContent = (a.currentTime / 1000).toFixed(1) + ' s'; } }, 200);

// themes: light / SDS dark / OLED (dark without sds), like the app
document.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => {
  root.className = { light: '', dark: 'dark sds', oled: 'dark' }[b.dataset.theme];
  document.querySelectorAll('[data-theme]').forEach(x => x.classList.toggle('on', x === b));
});
document.getElementById('scale').oninput = e => { scale = +e.target.value; grid.style.setProperty('--s', scale); };

// soft cut-outs around the content (same as the component), measured in tile pixels
function measureHoles(tile) {
  const base = tile.getBoundingClientRect(), k = base.width / 1300;
  const rects = [...tile.querySelectorAll('.c-greet, .c-input, [data-welcome-avoid]')].map(el => {
    const b = el.getBoundingClientRect();
    return `<rect x='${Math.round((b.left - base.left) / k - 14)}' y='${Math.round((b.top - base.top) / k - 14)}' width='${Math.round(b.width / k + 28)}' height='${Math.round(b.height / k + 28)}' rx='24'/>`;
  }).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1300' height='850'><filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='6'/></filter><g filter='url(#b)'>${rects}</g></svg>`;
  const g = tile.querySelector('.grid');
  g.classList.add('holes');
  g.style.setProperty('--welcome-holes', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}
document.querySelectorAll('.tile').forEach(measureHoles);

// ratings (kept in this browser)
const ratings = JSON.parse(localStorage.getItem('welcome-ratings-r2') || '{}');
document.querySelectorAll('.cell').forEach(cell => {
  const i = cell.dataset.i, buttons = cell.querySelectorAll('.stars button');
  const show = () => buttons.forEach(b => b.classList.toggle('on', +b.dataset.v <= (ratings[i] || 0)));
  buttons.forEach(b => b.onclick = () => { ratings[i] = +b.dataset.v; localStorage.setItem('welcome-ratings-r2', JSON.stringify(ratings)); show(); });
  show();
});
document.getElementById('copy').onclick = async () => {
  const text = VARIANTS.map(([name, d], i) => `${name}: ${ratings[i] ? ratings[i] + '/5' : 'nicht bewertet'}\\n  ${d}`).join('\\n');
  await navigator.clipboard.writeText(text);
  document.getElementById('copy').textContent = 'Kopiert ✓';
  setTimeout(() => document.getElementById('copy').textContent = 'Bewertungen kopieren', 1500);
};
</script></body></html>'''

out = pathlib.Path(__file__).with_name('variants.html')
out.write_text(PAGE)
print(out)
