<sub>*Hero made by [@ybouane](https://x.com/ybouane).*</sub>
<p align="center">
  <img src="https://crazygl.com/heroes/hero-draggable-portfolio-cards/banner-full.png" alt="Draggable Portfolio Cards" width="640">
</p>

# @crazygl/hero-draggable-portfolio-cards

Portfolio cards float behind the headline and can be dragged with momentum, making the hero feel tactile and playful.

## Demo
[Draggable Portfolio Cards](https://crazygl.com/hero/draggable-portfolio-cards)

## Install

```bash
npm install @crazygl/hero-draggable-portfolio-cards
```

## Usage

```tsx
import DraggablePortfolioCards from '@crazygl/hero-draggable-portfolio-cards';

export default function Page() {
  return (
    <DraggablePortfolioCards
      heading={"A stack you\ncan explore."}
      card1Image="/shots/dashboard.avif"
      cardCount={5}
      cursorTilt={0.7}
    />
  );
}
```

## Customise

- **Content** — `contentType`, `heading`, `subheading`, or custom nodes.
- **Screenshots** — `card1Image`–`card5Image` (your real product shots; ~16:9 reads best).
- **Stack** — `cardCount` (2–6), `cardSize`, `cardCornerRadius`, `groupOffsetX/Y`.
- **Motion** — `cursorTilt` (pointer parallax), `ambientFloat` (idle bob).
- **Style** — `edgeGlowColor` / `edgeGlowStrength`, `shadowStrength`.
- **Lighting** — `keyColor`, `fillColor`, `screenBrightness` (emissive boost on the screenshots).
- **Background** — `bgTop` / `bgBottom`.

## Best for

- Product studios and agency portfolios showing several screens at once.
- SaaS launch pages cycling through dashboards, builders, and editors.
- Template or theme marketplaces with a gallery of previews.
- Editorial showcases wanting a tactile, playful first impression.



This hero is part of [CrazyGL](https://crazygl.com), a collection of production-ready WebGL, canvas, 3D, and typography effects. Every CrazyGL hero ships with an agent-ready `SKILL.md` file that helps developers and coding agents adapt the effect into custom landing pages and interactive experiences.
