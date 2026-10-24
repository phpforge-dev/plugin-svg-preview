# SVG Preview

Live SVG source preview, zoom, backgrounds and recoverable XML errors.

Standalone PHPForge IDE plugin, extracted from the MIT-licensed PHPForge implementation. Requires IDE 0.2.13. Install this repository through Plugins and explicitly allow `project.read` and `workbench`. Workbench code runs in the trusted IDE window; it is not a sandbox. No native executable or Node runtime is used.

Disabling or removing the plugin releases its layout, callbacks, observers and pending results, restoring the editor. Document data stays local.

Build and validate with `npm ci --ignore-scripts`, `npm test`, `npm run build`. Committed browser bundles are verified by CI. Package tests exercise rendering and lifecycle in a simulated DOM; actual Tauri window checks belong to the host integration.
