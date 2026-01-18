# `npx posva`

```bash
npx posva
```

## Docs

### Terminal Image Support

The CLI automatically detects terminal capabilities and displays the avatar using the best available method:

- **Kitty**: Uses the [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) - detected via `KITTY_WINDOW_ID` or `TERM` containing `kitty`
- **iTerm2**: Uses [iTerm2 Inline Images Protocol](https://iterm2.com/documentation-images.html) - detected via `ITERM_SESSION_ID` or `TERM_PROGRAM=iTerm.app`
- **Fallback**: ASCII art from `bin/avatar.txt`

#### How the image protocols work

Both protocols embed base64-encoded PNG data in terminal escape sequences:

**Kitty**: `ESC_Ga=T,f=100,c=<cols>,r=<rows>,m=0;<base64>ESC\`

**iTerm2**: `ESC]1337;File=inline=1;width=<cols>;height=<rows>:<base64>BEL`

The image (`avatar-transparent@2x.png`) is read at runtime and encoded directly in the escape sequence output
