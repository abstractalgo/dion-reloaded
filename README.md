| This project | original Dion Systems |
| ------ | ------ |
| ![](.github/docs/dion-reloaded.gif) | ![](.github/docs/dion.gif) |

This project was directly inspired by [Dion Systems](#more-on-dion-systems) - a custom-built code editor that works directly with the AST representation, for both editing and rendering.

Here, we have a Monaco editor for users to input the [Typescript] source code. It then parses it and generates AST using `typescript` package. It then uses the generated AST to render things in the `<canvas>` that you can pan around and zoom (semantically) in and out of.

This functionality is a very basic and crude approximation of what the original Dion Systems was able to achieve, but still, this toy project served as a fun exploration on the topic of [textual](https://x.com/prathyvsh/status/1953124030296240302) [semantic zoom](https://x.com/prathyvsh/status/1949135449634513368).

# Local dev

Project uses [`bun`](https://bun.com/) runtime.

```sh
bun i       # to install dependencies
bun run dev # to run locally
```

# More on Dion Systems

- https://github.com/4coder-archive/4coder
- https://handmade.network/snippet/251
- https://www.youtube.com/watch?v=bpni9rEU850
- https://vimeo.com/485177664
- https://www.youtube.com/watch?v=GB_oTjVVgDc
- https://web.archive.org/web/20220918192200/https://dion.systems/
- https://x.com/msimoni/status/1695076884269117469
- https://news.ycombinator.com/item?id=32372707

# Next

It would be very interesting to try the LOD-based code rendering with something like GPUI (https://www.gpui.rs/, https://github.com/zed-industries/zed/tree/main/crates/gpui) and have it natively integrated into Zed (https://zed.dev/).