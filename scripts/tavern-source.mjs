import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(fs.readFileSync(path.join(root, 'release/app/package.json'), 'utf8')).version
const candidates = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }).toString().split('\0').filter(Boolean)
const zip = new AdmZip()
for (const relative of new Set(candidates)) {
  if (/^(private|\.toolchain|dist-tavern|node_modules|\.git)\//.test(relative) || /(^|\/)local\.properties$/.test(relative)) continue
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue
  zip.addLocalFile(absolute, `StoryTavern-${version}/${path.posix.dirname(relative)}`)
}
const output = path.join(root, 'dist-tavern', `StoryTavern-${version}-source.zip`)
fs.mkdirSync(path.dirname(output), { recursive: true })
zip.writeZip(output)
console.log(`Source archive: ${output} (${zip.getEntries().length} files)`)
