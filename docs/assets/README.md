# Vendored documentation assets

The manual is a static [docsify](https://docsify.js.org/) site. Its runtime is
committed here so the site has no CDN dependency and works behind networks that
block Google Fonts or public JavaScript CDNs.

| Asset | Version | License |
| --- | --- | --- |
| `docsify/docsify.min.js`, `docsify/vue.css` | 4.13.1 | MIT (`docsify/LICENSE`) |
| `docsify/plugins/search.min.js` | 4.13.1 | MIT (`docsify/LICENSE`) |
| `docsify/plugins/zoom-image.min.js` | 4.13.1 | MIT (`docsify/LICENSE`) |
| `plugins/docsify-copy-code.min.js` | 3.0.2 | MIT (`plugins/LICENSE-docsify-copy-code`) |
| `plugins/docsify-pagination.min.js` | 2.10.1 | MIT (`plugins/LICENSE-docsify-pagination`) |

`spice-logo.png` and `favicon.png` are copied from the application's `static/`
directory. `site.css` is the local theme.

Upgrade the first three by extracting the `lib/` directory of the corresponding
`docsify` npm package; upgrade the plugins from their `dist/` directories. The
Google Fonts import at the top of `vue.css` is intentionally removed because
`site.css` sets a local system font stack.
