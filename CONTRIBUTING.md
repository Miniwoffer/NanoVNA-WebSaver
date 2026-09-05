# Contributing

Thanks for helping out. This is a browser application with no backend,
no build step and no dependencies — that constraint is deliberate, and
the easiest way to help is to keep it true.

## Getting set up

Everything you need is a browser and, for the tests, node.

```sh
make web-serve          # serve it on http://localhost:8000
make web-test           # run the test suite
```

There is nothing to install, no virtualenv, no bundler and no lockfile.
`web/` is the document root; a change is live on reload.

Talking to a real device needs the Web Serial API, so Chrome, Edge or
Opera on the desktop. Firefox and Safari can still load, analyse and
export Touchstone files.

## House rules

- **No dependencies and no build step.** Vanilla ES modules, served as
  they are written. If something seems to need a library, it probably
  needs a smaller idea instead.
- **Text goes in through `textContent`,** never `innerHTML`, so a device
  or a file can never inject markup. The helpers in `web/js/ui/dom.js`
  do this for you; use them.
- **Charts are drawn on a canvas** by the classes in `web/js/charts/`.
- Keep the GPL header at the top of each file.
- Match the surrounding style rather than introducing a new one.

## Tests

`web/tests/` runs under plain node — no framework, no runner to install.
Add a case next to the ones it belongs with, and run the full suite
before opening a pull request.

The RF code is a port of the upstream NanoVNA-Saver desktop application,
and is checked against reference vectors generated from it
(`web/tests/reference.json`) and against its Touchstone and calibration
fixtures (`web/tests/data/`). If you change that code, keep it agreeing
with the original — the desktop application is the specification.

Anything pointer-driven or visual (drags, popovers, canvas output) is
outside what the node suite can reach; check those in a real browser and
say in the pull request what you checked.

## Licence

By contributing you agree that your work is licensed under the GNU
General Public License v3 or later, as the rest of the project is.
