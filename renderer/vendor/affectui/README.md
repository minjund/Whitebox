# affectUI workspace controls

Official MIT-licensed Clean sources copied from the already approved draft:

- https://www.affectui.com/r/button-clean.json
- https://www.affectui.com/r/segmented-control-clean.json
- https://www.affectui.com/r/thinking-loader-clean.json

`LICENSE` contains affectUI's MIT notice. `React-LICENSE` and
`ReactDOM-LICENSE` cover the React 19 runtime bundled with these controls.
`renderer/workspace-affectui-source.tsx` integrates only controls into the existing
workspace. It does not own terminal DOM nodes, the IPC bridge, or live sessions.
The application reads only the local prebuilt `renderer/workspace-affectui.js`;
no CDN, network stylesheet, or runtime package installation is used.

To rebuild, provide React 19, ReactDOM 19 and esbuild as build-time modules,
then run from the repository root:

```sh
NODE_PATH=/path/to/build/node_modules node scripts/build-workspace-ui.js
```

The root release manifest does not need a runtime dependency for these bundled
controls. Source hashes and download origins are in `provenance.json`.
