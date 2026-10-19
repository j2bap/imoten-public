# React Effect evidence

Use these sources to judge an Effect. The first three are React's official guidance. The paper gives a formal model of Hook execution.

- [React `useEffect` reference](https://react.dev/reference/react/useEffect) defines an Effect as synchronization with an external system.
- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) tells you to calculate derived values during render and handle user actions in event handlers.
- [`eslint-plugin-react-hooks`](https://react.dev/reference/eslint-plugin-react-hooks) checks Hook correctness. Its [`set-state-in-effect`](https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect) rule detects synchronous state updates that force another render.
- Lee, Ahn, and Yi's [React-tRace semantics paper](https://doi.org/10.1145/3763067) models Hook rendering and Effect behavior. It supports treating Effect timing and dependencies as program semantics, not style.

These sources support review of every new Effect. They do not support a blanket ban because React needs Effects at real external-system boundaries.
