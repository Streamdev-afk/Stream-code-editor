import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'

/**
 * Package an object of { path: { content, language } } into a zip blob.
 * Returns a Blob you can download.
 */
export function exportProjectToZip(files) {
  const tree = {}

  for (const [path, file] of Object.entries(files)) {
    // Skip our internal placeholder files
    if (path.endsWith('.gitkeep')) continue
    tree[path] = strToU8(file.content || '')
  }

  // Add a README with context
  const readme = `# Exported from Stream

This project was exported from Stream, an AI code editor.

Files: ${Object.keys(files).length}
Exported: ${new Date().toISOString()}

To run this project, open the files in your editor of choice.
`
  tree['STREAM_README.md'] = strToU8(readme)

  const zipped = zipSync(tree, { level: 6 })
  return new Blob([zipped], { type: 'application/zip' })
}

/**
 * Download a blob as a file.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Read a zip File object and return a files map.
 * Pass a name filter function to skip junk (node_modules, .git, etc).
 */
export async function importZipToFiles(zipFile) {
  const arrayBuffer = await zipFile.arrayBuffer()
  const unzipped = unzipSync(new Uint8Array(arrayBuffer))

  const files = {}
  for (const [path, bytes] of Object.entries(unzipped)) {
    // Skip directories, junk, and hidden files
    if (path.endsWith('/')) continue
    if (path.includes('__MACOSX/')) continue
    if (path.endsWith('.DS_Store')) continue
    if (path.startsWith('node_modules/')) continue
    if (path.includes('/node_modules/')) continue
    if (path.startsWith('.git/')) continue
    if (path.includes('/.git/')) continue
    if (path.endsWith('.log')) continue

    // Skip binary files by extension (rough heuristic)
    const ext = path.split('.').pop()?.toLowerCase()
    const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'mp3', 'mp4', 'wav', 'pdf', 'zip', 'woff', 'woff2', 'ttf', 'otf']
    if (binaryExts.includes(ext)) continue

    try {
      const text = strFromU8(bytes)
      files[path] = { content: text }
    } catch {
      // Not valid UTF-8, skip
    }
  }

  return files
}