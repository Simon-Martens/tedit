const TINYMIST_VERSION = '0.15.2'
const TINYMIST_TYPST_VERSION = '0.15.0'

const TINYMIST_TARGETS = {
  'linux-x64': 'x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64': 'aarch64-unknown-linux-gnu.tar.gz',
  'darwin-x64': 'x86_64-apple-darwin.tar.gz',
  'darwin-arm64': 'aarch64-apple-darwin.tar.gz',
  'win32-x64': 'x86_64-pc-windows-msvc.zip',
  'win32-arm64': 'aarch64-pc-windows-msvc.zip',
}

module.exports = { TINYMIST_TARGETS, TINYMIST_TYPST_VERSION, TINYMIST_VERSION }
