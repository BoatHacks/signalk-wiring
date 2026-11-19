// Minimal command line parsing: `--name value`, `--flag`, and positionals.

export function parseArgs (argv = process.argv.slice(2)) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        out[camel(a.slice(2, eq))] = a.slice(eq + 1)
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out[camel(a.slice(2))] = argv[++i]
      } else {
        out[camel(a.slice(2))] = true
      }
    } else {
      out._.push(a)
    }
  }
  return out
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

export function fail (message) {
  console.error(message)
  process.exit(1)
}
