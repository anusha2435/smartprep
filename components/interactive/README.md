# Interactive UI Components

These components are opt-in wrappers. They do not own your data, replace existing buttons, or change page state. Wrap existing UI with `children` to add the interaction.

## Global Effects

Add global effects in `app/layout.tsx` inside `<body>`, before `{children}`:

```tsx
import { FluidCursor, NeuralBackground } from "@/components/interactive";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NeuralBackground />
        <FluidCursor />
        {children}
      </body>
    </html>
  );
}
```

Both components are fixed and pointer-safe. `FluidCursor` hides itself on coarse pointers and respects reduced motion.

## Local Effects

Use these in any page or component without changing existing fetching, hooks, or callbacks:

```tsx
import {
  DecryptingText,
  Magnetic,
  SpotlightCard,
  TiltGlareCard,
} from "@/components/interactive";

export default function Page() {
  return (
    <section>
      <h1>
        <DecryptingText text="SmartPrep AI" />
      </h1>

      <SpotlightCard>
        <h2>Interview readiness</h2>
        <p>Your existing content stays as children.</p>
      </SpotlightCard>

      <TiltGlareCard>
        <p>Premium CTA content</p>
      </TiltGlareCard>

      <Magnetic>
        <button type="button">Start interview</button>
      </Magnetic>
    </section>
  );
}
```

`Magnetic` renders a `div`, not a `button`, so passing a button child does not create invalid nested interactive HTML.

## Props

- `FluidCursor`: `enabled`, `snapSelector`, `dotClassName`, `ringClassName`, `className`
- `NeuralBackground`: `className`, `dotColor`, `maskSize`, `opacity`
- `Magnetic`: `children`, `className`, `style`, `strength`, `range`, `scale`, `disabled`
- `SpotlightCard`: all `div` props plus `children`, `spotlightSize`, `spotlightColor`
- `TiltGlareCard`: all `div` props plus `children`, `maxTilt`, `glare`
- `DecryptingText`: all `span` props plus `text`, `speed`, `delay`, `symbols`, `startOnMount`

