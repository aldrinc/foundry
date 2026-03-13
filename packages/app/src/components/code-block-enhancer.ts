/**
 * Code block enhancer — adds language labels and copy buttons to code blocks.
 *
 * Follows the Mattermost pattern: CodeBlock component shows a language label in
 * a header bar and a CopyButton for one-click copying. We do this as a DOM
 * hydration step (like hydrateMessageImageCarousels) so it works with the
 * server-rendered HTML from Zulip.
 */

const SVG_NS = "http://www.w3.org/2000/svg"

const CLIPBOARD_ICON_PATH =
  "M8 4V3a1 1 0 011-1h6a1 1 0 011 1v1m-8 0h8m-8 0H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2"
const CHECK_ICON_PATH = "M5 12l5 5L20 7"

/** Common language alias mapping (same concept as Mattermost's normalisation) */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  go: "Go",
  sh: "Shell",
  bash: "Bash",
  zsh: "Shell",
  css: "CSS",
  html: "HTML",
  xml: "XML",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  markdown: "Markdown",
  sql: "SQL",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  cs: "C#",
  csharp: "C#",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  php: "PHP",
  lua: "Lua",
  r: "R",
  scala: "Scala",
  perl: "Perl",
  dart: "Dart",
  toml: "TOML",
  ini: "INI",
  dockerfile: "Dockerfile",
  docker: "Dockerfile",
  graphql: "GraphQL",
  proto: "Protobuf",
  tex: "LaTeX",
  latex: "LaTeX",
  diff: "Diff",
  text: "Plain Text",
  txt: "Plain Text",
}

function getDisplayLanguage(langClass: string): string | null {
  // Extract language from class name: "language-python" → "python"
  const match = langClass.match(/language-(\S+)/)
  if (!match) return null

  const lang = match[1].toLowerCase()
  return LANGUAGE_ALIASES[lang] || lang.charAt(0).toUpperCase() + lang.slice(1)
}

function createSvgIcon(pathD: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("width", "14")
  svg.setAttribute("height", "14")
  svg.setAttribute("aria-hidden", "true")

  const path = document.createElementNS(SVG_NS, "path")
  path.setAttribute("d", pathD)
  svg.appendChild(path)

  return svg
}

/**
 * Hydrate code blocks inside a message content element.
 * Adds a language label and a copy button to each `<pre>` block.
 *
 * Returns a cleanup function that removes event listeners.
 */
export function hydrateCodeBlocks(container: HTMLElement): () => void {
  const cleanups: Array<() => void> = []

  for (const pre of container.querySelectorAll<HTMLPreElement>("pre")) {
    // Skip if already enhanced
    if (pre.dataset.codeEnhanced === "true") continue
    pre.dataset.codeEnhanced = "true"

    // Make pre position:relative for absolutely positioned children
    pre.style.position = "relative"

    const codeEl = pre.querySelector("code")
    const rawText = (codeEl || pre).textContent || ""

    // ── Language label ──
    const langDisplay = codeEl ? getDisplayLanguage(codeEl.className) : null
    if (langDisplay) {
      const langLabel = document.createElement("span")
      langLabel.className = "code-block-lang"
      langLabel.textContent = langDisplay
      pre.appendChild(langLabel)
    }

    // ── Copy button ──
    const copyBtn = document.createElement("button")
    copyBtn.type = "button"
    copyBtn.className = "code-block-copy"
    copyBtn.setAttribute("aria-label", "Copy code to clipboard")
    copyBtn.setAttribute("title", "Copy")
    copyBtn.appendChild(createSvgIcon(CLIPBOARD_ICON_PATH))

    let copyTimeout: ReturnType<typeof setTimeout> | undefined

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(rawText)

        // Show check icon briefly
        copyBtn.innerHTML = ""
        copyBtn.appendChild(createSvgIcon(CHECK_ICON_PATH))
        copyBtn.setAttribute("title", "Copied!")
        copyBtn.classList.add("code-block-copy--copied")

        if (copyTimeout) clearTimeout(copyTimeout)
        copyTimeout = setTimeout(() => {
          copyBtn.innerHTML = ""
          copyBtn.appendChild(createSvgIcon(CLIPBOARD_ICON_PATH))
          copyBtn.setAttribute("title", "Copy")
          copyBtn.classList.remove("code-block-copy--copied")
        }, 2000)
      } catch {
        // Clipboard API can fail in some contexts; silently ignore
      }
    }

    copyBtn.addEventListener("click", handleCopy)
    pre.appendChild(copyBtn)

    cleanups.push(() => {
      copyBtn.removeEventListener("click", handleCopy)
      if (copyTimeout) clearTimeout(copyTimeout)
    })
  }

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}
