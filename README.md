# Maze Individual Drug Study — AP Statistics Simulation

An interactive web simulation for learning **random assignment**, **blocking**, and **matched pairs** in experimental design.

## What it does

- Individuals run through a **randomly generated maze** (start = top-left green square, finish = bottom-right red square).
- Half receive a **focus drug** that truly helps them finish faster; half are **control**.
- As each individual finishes, its completion time is added to **side-by-side histograms**.
- Three assignment methods show how study design affects what you can conclude:

| Method | What happens | What you should see |
|--------|----------------|---------------------|
| **Random assignment** | Each individual gets drug or control by coin flip | Overlapping histograms — hard to tell if the drug helped |
| **Block assignment (block)** | Half of each block gets drug, half control | Clearer separation — blocking controls for block |
| **Matched pairs** | Every individual runs twice (drug & no drug, order counterbalanced) | Very clear drug advantage |

## How to run

You need a local web server (ES modules don't work when opening `index.html` directly as a file).

**Option A — Python (if installed):**
```bash
cd stat-sim
python -m http.server 8080
```
Then open http://localhost:8080 in your browser.

**Option B — VS Code / Cursor:** Use the "Live Server" extension on `index.html`.

## Project structure

```
stat-sim/
├── index.html          # Page layout
├── css/styles.css      # Visual styling
└── js/
    ├── app.js          # Main controller (starts simulation)
    ├── config.js       # Constants & helper math functions
    ├── maze.js         # Maze generation, drawing, animation
    ├── study.js        # Individuals, assignments, completion times
    └── charts.js       # Chart.js histograms
```

## Key ideas (AP Stats)

1. **Confounding** — Blocks differ in natural speed. If drug assignment isn't balanced across blocks, block can hide or fake a treatment effect.
2. **Blocking** — Assign treatment within each block so groups are comparable.
3. **Matched pairs** — Each subject serves as its own control; individual differences cancel out.

## Tweaking the simulation

Open `js/config.js`. Important values:

- `baseSpeed`, `blockSpeedSpread`, `individualSpeedSpread` — speed by block vs. individual individual
- `drugSpeedMultiplier` — how much the drug speeds up movement (with bell-curve noise)
- `learningMultiplier` — speed boost on a 2nd run through the same maze
- `timeNoise` — extra scatter by study design

### Maze toggle

- **New random maze each run (on):** Every run gets a fresh maze. Use **Fast forward** to skip animation and fill in histograms quickly.
- **New random maze each run (off):** Random/block designs run **all individuals at once** on the same maze. Matched pairs reuse each individual's maze — 2nd run is faster from practice.

### How individuals move

Individuals do **not** take the shortest path. At each junction they pick a random direction; at dead ends they **backtrack**. Completion time depends on how many steps they actually walk, their speed (block + individual + drug + learning), and bell-curve noise.

## Libraries used

- **[Chart.js](https://www.chartjs.org/)** — histograms (loaded from CDN in `index.html`)
- **Vanilla JavaScript** — no build step, easy to read and modify

## License

Free to use for classroom learning.
