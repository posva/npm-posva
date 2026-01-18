#!/usr/bin/env -S node --experimental-strip-types --no-warnings

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Terminal image protocol detection
type ImageProtocol = 'kitty' | 'iterm' | 'none'

function detectImageProtocol(): ImageProtocol {
  // Kitty: KITTY_WINDOW_ID or TERM contains 'kitty'
  if (process.env.KITTY_WINDOW_ID || process.env.TERM?.includes('kitty')) {
    return 'kitty'
  }
  // iTerm2: ITERM_SESSION_ID or TERM_PROGRAM is iTerm.app
  if (process.env.ITERM_SESSION_ID || process.env.TERM_PROGRAM === 'iTerm.app') {
    return 'iterm'
  }
  return 'none'
}

const imageProtocol = detectImageProtocol()

// Kitty graphics protocol: chunked base64 PNG
function kittyImage(pngPath: string, cols = 8, rows = 4): string {
  if (!existsSync(pngPath)) return ''
  const data = readFileSync(pngPath)
  const b64 = data.toString('base64')
  const chunks: string[] = []
  const chunkSize = 4096

  for (let i = 0; i < b64.length; i += chunkSize) {
    const chunk = b64.slice(i, i + chunkSize)
    const isFirst = i === 0
    const isLast = i + chunkSize >= b64.length
    const m = isLast ? 0 : 1

    if (isFirst) {
      // a=T: transmit+display, f=100: PNG, c/r: columns/rows
      chunks.push(`\x1b_Ga=T,f=100,c=${cols},r=${rows},m=${m};${chunk}\x1b\\`)
    } else {
      chunks.push(`\x1b_Gm=${m};${chunk}\x1b\\`)
    }
  }
  return chunks.join('')
}

// iTerm2 inline images: OSC 1337 with base64 PNG
function itermImage(pngPath: string, cols = 8, rows = 4): string {
  if (!existsSync(pngPath)) return ''
  const data = readFileSync(pngPath)
  const b64 = data.toString('base64')
  // width/height in cells, inline=1 to display
  return `\x1b]1337;File=inline=1;width=${cols};height=${rows}:${b64}\x07`
}

// Generate avatar based on protocol
function getGraphicalImage(): string | null {
  const pngPath = join(__dirname, '..', 'avatar-transparent@2x.png')

  if (imageProtocol === 'kitty') {
    return kittyImage(pngPath, 8, 4)
  } else if (imageProtocol === 'iterm') {
    return itermImage(pngPath, 8, 4)
  }
  return null
}

const graphicalImage = getGraphicalImage()

// ASCII avatar fallback
function getAsciiAvatarLines(): string[] {
  const asciiPath = join(__dirname, 'avatar.txt')
  const avatarRaw = existsSync(asciiPath) ? readFileSync(asciiPath, 'utf-8') : ''
  return avatarRaw
    .replace(/\x1b\[\?25[lh]/g, '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\s+(\x1b\[0m)?$/, '$1')) // trim trailing spaces before reset
}

// ASCII avatar lines (only used when no graphical support)
const avatarLines = graphicalImage ? [] : getAsciiAvatarLines()

// True color (24-bit) helper
const rgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`

// OSC 8 hyperlink (falls back to plain text if unsupported)
const link = (url: string, text: string) => `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`

const bold = '\x1b[1m'
const reset = '\x1b[0m'
const yellow = '\x1b[33m'

// Gradient colors (smooth rainbow, clockwise from top-left)
const g = [
  rgb(0, 255, 255), // cyan
  rgb(0, 200, 255), // sky blue
  rgb(0, 150, 255), // light blue
  rgb(50, 100, 255), // blue
  rgb(100, 50, 255), // indigo
  rgb(150, 0, 255), // purple
  rgb(200, 0, 255), // violet
  rgb(255, 0, 220), // magenta
  rgb(255, 0, 150), // pink
  rgb(255, 0, 100), // rose
  rgb(255, 50, 50), // red
  rgb(255, 100, 0), // orange
  rgb(255, 150, 0), // amber
  rgb(255, 200, 0), // gold
  rgb(255, 255, 0), // yellow
  rgb(200, 255, 0), // lime
  rgb(100, 255, 50), // light green
  rgb(0, 255, 100), // green
  rgb(0, 255, 150), // mint
  rgb(0, 255, 200), // aqua
]

const box = `
${g[0]}┏━━━━━━━${g[1]}━━━━━━━${g[2]}━━━━━━━${g[3]}━━━━━━${g[4]}━━━━━━${g[5]}━━━━━━${g[6]}━━━━━━${g[7]}━━━━━━${g[8]}━━━━━┓
${g[0]}┃${reset}                                                        ${g[9]}┃
${g[0]}┃${reset}   👋                                                   ${g[10]}┃
${g[0]}┃${reset}                                                        ${g[10]}┃
${g[0]}┃${reset}   I'm ${bold}Eduardo${reset} San Martin Morote                        ${g[10]}┃
${g[19]}┃${reset}   Author of ${link('https://router.vuejs.org', 'Vue Router')} and ${link('https://pinia.vuejs.org', 'Pinia')}, Vue.js Core team     ${g[11]}┃
${g[19]}┃${reset}                                                        ${g[11]}┃
${g[19]}┃${reset}   🐙 ${yellow}GitHub${reset}   ${link('https://github.com/posva', 'https://github.com/posva')}                 ${g[12]}┃
${g[19]}┃${reset}   🐦 ${yellow}X${reset}        ${link('https://x.com/posva', '@posva')}                                   ${g[12]}┃
${g[19]}┃${reset}   🦋 ${yellow}Bluesky${reset}  ${link('https://bsky.app/profile/esm.dev', '@esm.dev')}                                 ${g[13]}┃
${g[19]}┃${reset}   🌐 ${yellow}Web${reset}      ${link('https://esm.dev', 'https://esm.dev')}                          ${g[13]}┃
${g[19]}┃${reset}                                                        ${g[14]}┃
${g[19]}┗━━━━━━━━${g[18]}━━━━━━━━${g[17]}━━━━━━━━${g[16]}━━━━━━━━${g[15]}━━━━━━━━${g[14]}━━━━━━━━${g[14]}━━━━━━━━┛${reset}
`

// Output box, then overlay avatar using cursor positioning
console.log(box)

// Cursor movement helpers
const up = (n: number) => `\x1b[${n}A`
const down = (n: number) => `\x1b[${n}B`
const right = (n: number) => `\x1b[${n}C`
const col1 = '\x1b[1G'

if (graphicalImage) {
  // Graphical image: single escape sequence
  process.stdout.write(`${up(6)}${right(49)}${graphicalImage}${down(6)}${col1}`)
} else if (avatarLines.length >= 4) {
  // ASCII avatar: render each line with cursor positioning
  const startLine = 6 // lines up from bottom
  const col = 49
  let output = up(startLine)
  for (let i = 0; i < 4; i++) {
    output += `${right(col)}${avatarLines[i]}${col1}${down(1)}`
  }
  output += down(startLine - 4) + col1
  process.stdout.write(output)
}
